import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mailer } from "../src/lib/mailer";

// RESEND_API_KEY が空(未設定)のときは、実際には送らず、宛先・件名・本文をログに出す。
// fetch を差し替えて「外部通信が起きない」ことを確かめる(実際の通信はしない)。
const mail = { to: ["a@example.com", "b@example.com"], subject: "招待のお知らせ", text: "招待リンク: http://localhost:3000/invite/xyz" };

let logSpy: ReturnType<typeof spyOn>;
let fetchSpy: ReturnType<typeof spyOn>;
const savedKey = process.env.RESEND_API_KEY;
const savedEnv = process.env.NODE_ENV;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
    throw new Error("外部に通信してはいけない");
  }) as unknown as typeof fetch);
});
afterEach(() => {
  logSpy.mockRestore();
  fetchSpy.mockRestore();
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
  if (savedEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedEnv;
});

test("RESEND_API_KEY が空文字でも、送らず、宛先・件名・本文をログに出す", async () => {
  process.env.RESEND_API_KEY = "";
  process.env.NODE_ENV = "development";
  const result = await mailer.send(mail);
  expect(result).toEqual({ ok: false, skipped: true });
  expect(fetchSpy).not.toHaveBeenCalled();
  const out = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  expect(out).toContain("a@example.com, b@example.com");
  expect(out).toContain("招待のお知らせ");
  expect(out).toContain("http://localhost:3000/invite/xyz");
});

test("RESEND_API_KEY が未設定でも、送らない", async () => {
  delete process.env.RESEND_API_KEY;
  const result = await mailer.send({ ...mail, to: "c@example.com" });
  expect(result).toEqual({ ok: false, skipped: true });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("NODE_ENV=production では、本文をログに出さない(宛先と件名のみ)", async () => {
  process.env.RESEND_API_KEY = "";
  process.env.NODE_ENV = "production";
  await mailer.send(mail);
  const out = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  expect(out).toContain("a@example.com");
  expect(out).toContain("招待のお知らせ");
  expect(out).not.toContain("invite/xyz");
});
