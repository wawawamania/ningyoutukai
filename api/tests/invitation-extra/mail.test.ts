import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { products } from "../../src/db/schema";
import { mailer } from "../../src/lib/mailer";
import { cleanup, createInvitee, createOutsider, inviteTo, list, setupProduct, uniq, type Ctx } from "./helpers";

// メール通知。mailer.send は spyOn で差し替え、外部(Resend)には送らない。

let p: Ctx;
const sendSpy = spyOn(mailer, "send");
const invite = (body: unknown, productId = p.productId, cookie = p.leader.cookie) =>
  inviteTo(productId, cookie, body);
let originalKey: string | undefined;

beforeAll(async () => {
  p = await setupProduct({ members: 1 });
  originalKey = process.env.RESEND_API_KEY;
});
afterEach(() => {
  sendSpy.mockReset();
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
});
afterAll(async () => {
  sendSpy.mockRestore();
  await cleanup();
});

describe("メール通知", () => {
  it("登録済みの人をメールで招待すると、mailer.send が 1 回だけ呼ばれ、宛先・件名・本文が正しい", async () => {
    sendSpy.mockResolvedValue({ ok: true });
    const u = await createInvitee();
    const res = await invite({ email: u.email.toUpperCase() });
    expect(res.status).toBe(201);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const mail = sendSpy.mock.calls[0]![0];
    expect(mail.to).toBe(u.email); // 登録済みならそのメール(大文字小文字は登録されているもの)
    expect(mail.subject).toContain("招待");
    expect(mail.text).toContain("leader");
  });
  it("未登録の相手をメールで招待すると、入力したメールに送られる", async () => {
    sendSpy.mockResolvedValue({ ok: true });
    const email = `unreg-${uniq()}@example.com`;
    expect((await invite({ email })).status).toBe(201);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![0].to).toBe(email);
  });
  it("GitHub username だけで未登録の相手には送らない。登録済みの GitHub 招待にはそのメールへ送る", async () => {
    sendSpy.mockResolvedValue({ ok: true });
    expect((await invite({ githubId: `nobody-${uniq()}` })).status).toBe(201);
    expect(sendSpy).not.toHaveBeenCalled();

    const gh = `reg-${uniq()}`;
    const u = await createInvitee(gh);
    expect((await invite({ githubId: gh })).status).toBe(201);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![0].to).toBe(u.email);
  });
  it("失敗した招待(409・400・403・404)ではメールを送らない", async () => {
    sendSpy.mockResolvedValue({ ok: true });
    const u = await createInvitee();
    expect((await invite({ email: u.email })).status).toBe(201);
    sendSpy.mockClear();
    expect((await invite({ email: u.email })).status).toBe(409);
    expect((await invite({ email: p.leader.email })).status).toBe(400);
    expect((await invite({ email: p.members[0]!.email })).status).toBe(409);
    expect((await invite({ email: u.email }, p.productId, p.members[0]!.cookie)).status).toBe(403);
    const o = await createOutsider();
    expect((await invite({ email: u.email }, p.productId, o.cookie)).status).toBe(404);
    expect(sendSpy).not.toHaveBeenCalled();
  });
  it("送信が失敗した結果(ok: false)を返しても、招待は 201 で成功し、本人に届く", async () => {
    sendSpy.mockResolvedValue({ ok: false, error: "Resend 500: boom" });
    const u = await createInvitee();
    const res = await invite({ email: u.email });
    expect(res.status).toBe(201);
    expect(((await (await list(u.cookie)).json()) as unknown[]).length).toBe(1);
  });
  it("メール本文(プレーンテキスト)には招待相手の GitHub username などの余計な情報を含まない", async () => {
    sendSpy.mockResolvedValue({ ok: true });
    const u = await createInvitee();
    await invite({ email: u.email });
    const mail = sendSpy.mock.calls[0]![0];
    expect(mail.text).not.toContain(u.userId);
    expect(mail.text).not.toContain(p.leader.email);
  });
  it("プロダクト名に HTML があっても、メールはプレーンテキスト(text のみで html を持たない)", async () => {
    sendSpy.mockResolvedValue({ ok: true });
    const name = `<script>alert(1)</script>-${uniq()}`;
    await db.update(products).set({ productName: name }).where(eq(products.productId, p.productId));
    const u = await createInvitee();
    expect((await invite({ email: u.email })).status).toBe(201);
    const mail = sendSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(mail).sort()).toEqual(["subject", "text", "to"]);
    // 文字列としてそのまま入る(HTML としては解釈されない形式のため、エスケープは不要)
    expect(String(mail.text)).toContain(name);
  });
  it("RESEND_API_KEY が無いとき(モックなし)は、外部に送らず、招待は成功する", async () => {
    sendSpy.mockRestore(); // 本物の mailer.send に戻す
    delete process.env.RESEND_API_KEY;
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetched++;
      return realFetch(...args);
    }) as unknown as typeof fetch;
    try {
      const res = await invite({ email: `nokey-${uniq()}@example.com` });
      expect(res.status).toBe(201);
      expect(fetched).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it("RESEND_API_KEY があり、外部への通信が失敗(ネットワークエラー)しても、招待は成功する", async () => {
    sendSpy.mockRestore();
    process.env.RESEND_API_KEY = "test-key";
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    // 外部には出ない。Resend への fetch をスタブにして、失敗させる
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input));
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await invite({ email: `neterr-${uniq()}@example.com` });
      expect(res.status).toBe(201);
      expect(calls).toEqual(["https://api.resend.com/emails"]);
    } finally {
      globalThis.fetch = realFetch;
      errSpy.mockRestore();
    }
  });
});
