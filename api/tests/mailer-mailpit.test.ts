import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mailer, parseAddress } from "../src/lib/mailer";

// MAILPIT_URL があるときは、Mailpit の HTTP 送信 API(POST /api/v1/send)に送る。
// fetch を差し替えて検証する(実際の通信はしない)。
const mail = { to: "a@example.com", subject: "招待のお知らせ", text: "招待リンク: http://localhost:3000/invite/xyz" };

let fetchSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;
let logSpy: ReturnType<typeof spyOn>;
const keys = ["MAILPIT_URL", "MAIL_FROM", "RESEND_API_KEY", "NODE_ENV"] as const;
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

function mockFetch(impl: () => Promise<Response>) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
}
const okResponse = () => Promise.resolve(new Response(JSON.stringify({ ID: "x" }), { status: 200 }));
const sentBody = () => JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));

beforeEach(() => {
  process.env.MAILPIT_URL = "http://localhost:8025";
  process.env.NODE_ENV = "development";
  delete process.env.MAIL_FROM;
  delete process.env.RESEND_API_KEY;
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  fetchSpy?.mockRestore();
  errSpy.mockRestore();
  logSpy.mockRestore();
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("MAILPIT_URL があれば、/api/v1/send に JSON で送る", async () => {
  mockFetch(okResponse);
  const result = await mailer.send(mail);
  expect(result).toEqual({ ok: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("http://localhost:8025/api/v1/send");
  expect(init.method).toBe("POST");
  expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  expect(sentBody()).toEqual({
    From: { Email: "noreply@localhost", Name: "人形使い" },
    To: [{ Email: "a@example.com" }],
    Subject: mail.subject,
    Text: mail.text,
  });
});

test("末尾のスラッシュがあっても URL が崩れない。Resend のキーがあっても Mailpit を優先する", async () => {
  process.env.MAILPIT_URL = "http://localhost:8025/";
  process.env.RESEND_API_KEY = "re_dummy";
  mockFetch(okResponse);
  await mailer.send(mail);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:8025/api/v1/send");
});

test("MAIL_FROM の `名前 <addr>` を Email と Name に分ける", async () => {
  process.env.MAIL_FROM = "テスト送信元 <from@example.com>";
  mockFetch(okResponse);
  await mailer.send(mail);
  expect(sentBody().From).toEqual({ Email: "from@example.com", Name: "テスト送信元" });
});

test("宛先が複数でも送れる", async () => {
  mockFetch(okResponse);
  await mailer.send({ ...mail, to: ["a@example.com", "b@example.com"] });
  expect(sentBody().To).toEqual([{ Email: "a@example.com" }, { Email: "b@example.com" }]);
});

test("NODE_ENV=production では MAILPIT_URL を無視する(Mailpit に送らない)", async () => {
  process.env.NODE_ENV = "production";
  mockFetch(okResponse);
  const result = await mailer.send(mail);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(result).toEqual({ ok: false, skipped: true });
});

test("production で MAILPIT_URL があっても、Resend が設定されていれば Resend に送る", async () => {
  process.env.NODE_ENV = "production";
  process.env.RESEND_API_KEY = "re_dummy";
  mockFetch(okResponse);
  await mailer.send(mail);
  expect(fetchSpy.mock.calls[0][0]).toBe("https://api.resend.com/emails");
});

test("Mailpit が 4xx/5xx を返しても例外を投げず、{ ok: false, error } を返す", async () => {
  mockFetch(() => Promise.resolve(new Response("boom", { status: 500 })));
  const result = await mailer.send(mail);
  expect(result).toEqual({ ok: false, error: "Mailpit 500: boom" });
  expect(errSpy).toHaveBeenCalled();
});

test("Mailpit に接続できなくても例外を投げず、{ ok: false, error } を返す", async () => {
  mockFetch(() => Promise.reject(new Error("ECONNREFUSED")));
  const result = await mailer.send(mail);
  expect(result).toEqual({ ok: false, error: "ECONNREFUSED" });
});

test("parseAddress: 名前付き・アドレスのみ・引用符つき", () => {
  expect(parseAddress("a@example.com")).toEqual({ Email: "a@example.com" });
  expect(parseAddress("人形使い <n@example.com>")).toEqual({ Email: "n@example.com", Name: "人形使い" });
  expect(parseAddress('"A B" <n@example.com>')).toEqual({ Email: "n@example.com", Name: "A B" });
  expect(parseAddress("<n@example.com>")).toEqual({ Email: "n@example.com" });
});
