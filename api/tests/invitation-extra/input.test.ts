import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mailer } from "../../src/lib/mailer";
import {
  cleanup,
  createInvitee,
  findInvitation,
  inviteTo,
  invitationsOf,
  request,
  setupProduct,
  uniq,
  type Ctx,
} from "./helpers";

// 招待作成の入力の境界。外部へのメール送信は spyOn で止める。

let p: Ctx;
const sendSpy = spyOn(mailer, "send");
const invite = (body: unknown, cookie = p.leader.cookie, productId = p.productId) =>
  inviteTo(productId, cookie, body);

beforeAll(async () => {
  p = await setupProduct({ members: 1 });
  sendSpy.mockResolvedValue({ ok: true });
});
afterEach(() => sendSpy.mockClear());
afterAll(async () => {
  sendSpy.mockRestore();
  await cleanup();
});

async function expectMessage(res: Response, status: number) {
  expect(res.status).toBe(status);
  const body = (await res.json()) as { message: unknown };
  expect(typeof body.message).toBe("string");
  expect(Object.keys(body)).toEqual(["message"]);
  // 英語の生の文ではなく、日本語のメッセージ
  expect(body.message as string).toMatch(/[぀-ヿ一-鿿]/);
}

describe("githubId の形式", () => {
  it("前後の空白は取り除いて保存される", async () => {
    const gh = `ws-${uniq()}`;
    const res = await invite({ githubId: `  ${gh}\t` });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ inviteeIdentifier: gh, inviteeType: "github" });
  });
  it("大文字で招待しても、小文字で登録済みの人に届く(user_id が結びつく)", async () => {
    const gh = `MiXeD-${uniq()}`;
    const u = await createInvitee(gh.toLowerCase());
    const res = await invite({ githubId: gh });
    expect(res.status).toBe(201);
    const row = await findInvitation(((await res.json()) as { invitationId: string }).invitationId);
    expect(row!.userId).toBe(u.userId);
  });
  it("100 文字は通り、101 文字は 422", async () => {
    expect((await invite({ githubId: "a".repeat(100) })).status).toBe(201);
    await expectMessage(await invite({ githubId: "a".repeat(101) }), 422);
  });
  it("500 文字の githubId は 422", async () => {
    await expectMessage(await invite({ githubId: "a".repeat(500) }), 422);
  });
  it("SQL 風の文字列は、そのままの文字列として保存され、他のテーブルに影響しない", async () => {
    const gh = `x' OR '1'='1'; DROP TABLE users;-- ${uniq()}`;
    const res = await invite({ githubId: gh });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ inviteeIdentifier: gh });
    expect((await request("GET", "/api/product", { cookie: p.leader.cookie })).status).toBe(200);
  });
  it("<script> や絵文字を含む値も、そのまま文字列として保存される(メールは送られない)", async () => {
    const gh = `<script>alert(1)</script>-${uniq()}`;
    const res = await invite({ githubId: gh });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ inviteeIdentifier: gh });
    const emoji = `😀-${uniq()}`;
    expect((await invite({ githubId: emoji })).status).toBe(201);
    expect(sendSpy).not.toHaveBeenCalled();
  });
  it("全角の文字も、そのまま別の文字として扱われる(全角と半角は別人)", async () => {
    const half = `abc${uniq()}`;
    const full = half.replace(/[a-z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    expect((await invite({ githubId: half })).status).toBe(201);
    expect((await invite({ githubId: full })).status).toBe(201);
  });
  it("空白だけの githubId は 400、空文字も 400", async () => {
    await expectMessage(await invite({ githubId: "   " }), 400);
    await expectMessage(await invite({ githubId: "" }), 400);
  });
});

describe("email の形式", () => {
  it("前後の空白は取り除かれる", async () => {
    const email = `ws-${uniq()}@example.com`;
    const res = await invite({ email: `  ${email} ` });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ inviteeIdentifier: email, inviteeType: "gmail" });
    expect(sendSpy.mock.calls[0]![0].to).toBe(email);
  });
  it("形式が不正なものは 400(@ なし、@ が複数、ドメインなし、ドットなし、途中に空白)", async () => {
    for (const email of ["plain", "a@b@example.com", "a@", "@example.com", "a@example", "a b@example.com", "a@exa mple.com"]) {
      const res = await invite({ email });
      expect({ email, status: res.status }).toEqual({ email, status: 400 });
    }
    expect(sendSpy).not.toHaveBeenCalled();
  });
  it("254 文字は通り、255 文字は 422、500 文字も 422", async () => {
    const local = "a".repeat(254 - "@example.com".length);
    expect((await invite({ email: `${local}@example.com` })).status).toBe(201);
    await expectMessage(await invite({ email: `a${local}@example.com` }), 422);
    await expectMessage(await invite({ email: `${"a".repeat(500)}@example.com` }), 422);
  });
  it("メールの大文字・小文字違いは、同じ人として重複扱い(409)", async () => {
    const email = `case-${uniq()}@example.com`;
    expect((await invite({ email })).status).toBe(201);
    await expectMessage(await invite({ email: email.toUpperCase() }), 409);
  });
  it("Gmail の別名(+ や .)は別のメールアドレスとして扱われる(別々に招待できる)", async () => {
    const base = `alias${uniq()}`;
    expect((await invite({ email: `${base}@example.com` })).status).toBe(201);
    expect((await invite({ email: `${base}+tag@example.com` })).status).toBe(201);
    expect((await invite({ email: `${base.slice(0, 3)}.${base.slice(3)}@example.com` })).status).toBe(201);
  });
  it("絵文字・全角・<script> を含むメールは、形式が合えば保存され、5xx にならない", async () => {
    for (const email of [`😀${uniq()}@example.com`, `ａｂｃ${uniq()}@example.com`, `<script>${uniq()}@example.com`]) {
      const res = await invite({ email });
      expect(res.status).toBe(201);
    }
  });
});

describe("body の型・形", () => {
  it("型が違う値(数値・配列・null・オブジェクト・真偽値)は 422", async () => {
    for (const body of [
      { githubId: 123 },
      { githubId: ["a"] },
      { githubId: null },
      { githubId: { a: 1 } },
      { email: 123 },
      { email: ["a@example.com"] },
      { email: null },
      { email: true },
    ]) {
      const res = await invite(body);
      expect({ body, status: res.status }).toEqual({ body, status: 422 });
    }
  });
  it("body が配列・文字列・null・空のときは 4xx(5xx にならない)", async () => {
    for (const raw of ["[]", '"x"', "null", ""]) {
      const res = await request("POST", `/api/product/${p.productId}/invitation`, {
        cookie: p.leader.cookie,
        rawBody: raw,
      });
      expect({ raw, ok: res.status >= 400 && res.status < 500 }).toEqual({ raw, ok: true });
    }
  });
  it("壊れた JSON は 400 で { message } の形", async () => {
    const res = await request("POST", `/api/product/${p.productId}/invitation`, {
      cookie: p.leader.cookie,
      rawBody: "{ not json",
    });
    await expectMessage(res, 400);
  });
  it("余計なフィールドがあっても、無視されて招待は成功する(余計なフィールドは保存・返却されない)", async () => {
    const email = `extra-${uniq()}@example.com`;
    const res = await invite({
      email,
      role: "leader",
      status: "accepted",
      userId: p.leader.userId,
      productId: crypto.randomUUID(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "pending", productId: p.productId });
    expect(Object.keys(body).sort()).toEqual(
      ["createdAt", "inviteeIdentifier", "inviteeType", "invitationId", "productId", "respondedAt", "status"].sort()
    );
    const row = await findInvitation(body.invitationId as string);
    expect(row!.status).toBe("pending");
    expect(row!.userId).toBeNull();
  });
  it("githubId と email の両方が空文字や空白でも、どちらか一方だけが有効なら通る", async () => {
    const email = `blank-${uniq()}@example.com`;
    expect((await invite({ githubId: "  ", email })).status).toBe(201);
    expect((await invite({ githubId: `blank-${uniq()}`, email: "" })).status).toBe(201);
  });
});

describe("パスのパラメータ", () => {
  it("UUID でない値・前後に空白のある UUID・空のようなパスは 422 / 404(5xx にならない)", async () => {
    for (const id of ["abc", "%20", encodeURIComponent(` ${p.productId}`), encodeURIComponent(`${p.productId} `), `${p.productId}x`]) {
      const res = await invite({ email: "a@example.com" }, p.leader.cookie, id);
      expect({ id, status: res.status }).toEqual({ id, status: 422 });
    }
  });
  it("大文字の UUID でも、リーダーなら招待できる", async () => {
    const res = await invite({ email: `upper-${uniq()}@example.com` }, p.leader.cookie, p.productId.toUpperCase());
    expect(res.status).toBe(201);
  });
  it("招待が作られたのは、パスで指定したプロダクトだけ", async () => {
    const other = await setupProduct({ members: 0 });
    const email = `only-${uniq()}@example.com`;
    expect((await invite({ email }, other.leader.cookie, other.productId)).status).toBe(201);
    const mine = await invitationsOf(p.productId);
    expect(mine.some((i) => i.inviteeIdentifier === email)).toBe(false);
  });
});
