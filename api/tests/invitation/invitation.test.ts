import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import { productInvitations, productMembers, users } from "../../src/db/schema";
import { mailer } from "../../src/lib/mailer";
import { productRoutes } from "../../src/routes/product";
import { invitationRoutes } from "../../src/routes/invitation";
import { cleanup, createOutsider, setupProduct } from "../task/helpers";

const app = new Elysia().use(invitationRoutes).use(productRoutes);

function request(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  );
}

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
const sendSpy = spyOn(mailer, "send");

beforeAll(async () => {
  p = await setupProduct({ members: 1 });
  sendSpy.mockResolvedValue({ ok: true });
});
afterEach(() => sendSpy.mockClear());
afterAll(async () => {
  sendSpy.mockRestore();
  await cleanup();
});

/** 登録済み(users の行あり)の別ユーザーを作る。githubId を渡すと GitHub の username も持つ */
async function createInvitee(githubId?: string) {
  const o = await createOutsider();
  const res = await request("GET", "/api/invitation", { cookie: o.cookie }); // users の行を作る
  expect(res.status).toBe(200);
  if (githubId) {
    await db.update(users).set({ githubId }).where(eq(users.email, o.email));
  }
  const [row] = await db.select().from(users).where(eq(users.email, o.email));
  return { ...o, userId: row!.userId };
}

const invite = (body: unknown, cookie = p.leader.cookie, productId = p.productId) =>
  request("POST", `/api/product/${productId}/invitation`, { cookie, body });
const list = (cookie: string) => request("GET", "/api/invitation", { cookie });
const accept = (id: string, cookie?: string) =>
  request("POST", `/api/invitation/${id}/accept`, { cookie });
const reject = (id: string, cookie?: string) =>
  request("POST", `/api/invitation/${id}/reject`, { cookie });
const productIds = async (cookie: string) =>
  ((await (await request("GET", "/api/product", { cookie })).json()) as { productId: string }[]).map(
    (x) => x.productId
  );
const uniq = () => crypto.randomUUID().slice(0, 8);

describe("メンバー招待 POST /api/product/:productId/invitation", () => {
  it("cookie なしは 401", async () => {
    expect((await request("POST", `/api/product/${p.productId}/invitation`, { body: { email: "a@example.com" } })).status).toBe(401);
  });
  it("所属していないユーザーは 404", async () => {
    const o = await createOutsider();
    const res = await invite({ email: "a@example.com" }, o.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });
  it("存在しないプロダクトは 404、UUID でない値は 422", async () => {
    expect((await invite({ email: "a@example.com" }, p.leader.cookie, crypto.randomUUID())).status).toBe(404);
    expect((await invite({ email: "a@example.com" }, p.leader.cookie, "abc")).status).toBe(422);
  });
  it("メンバーは 403", async () => {
    const res = await invite({ email: "a@example.com" }, p.members[0]!.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
  });
  it("githubId と email の両方・どちらもなし・メール形式不正は 400", async () => {
    expect((await invite({ githubId: "x", email: "a@example.com" })).status).toBe(400);
    expect((await invite({})).status).toBe(400);
    expect((await invite({ githubId: "  " })).status).toBe(400);
    expect((await invite({ email: "not-an-email" })).status).toBe(400);
  });
  it("メールで登録済みユーザーを招待でき、メールが送られる", async () => {
    const u = await createInvitee();
    const res = await invite({ email: u.email.toUpperCase() });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      productId: p.productId,
      inviteeType: "gmail",
      status: "pending",
      respondedAt: null,
    });
    const [row] = await db
      .select()
      .from(productInvitations)
      .where(eq(productInvitations.invitationId, body.invitationId as string));
    expect(row!.userId).toBe(u.userId);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![0].to).toBe(u.email);
  });
  it("GitHub の username で登録済みユーザーを招待できる", async () => {
    const gh = `gh-${uniq()}`;
    const u = await createInvitee(gh);
    const res = await invite({ githubId: gh });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ inviteeType: "github", inviteeIdentifier: gh });
    const mine = (await (await list(u.cookie)).json()) as unknown[];
    expect(mine.length).toBe(1);
  });
  it("未登録のメールも招待でき(メール送信あり)、登録後に自分宛てとして届く", async () => {
    const o = await createOutsider();
    // users の行がまだ無い状態で招待する
    const res = await invite({ email: o.email });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invitationId: string };
    const [row] = await db
      .select()
      .from(productInvitations)
      .where(eq(productInvitations.invitationId, body.invitationId));
    expect(row!.userId).toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const mine = (await (await list(o.cookie)).json()) as { invitationId: string }[];
    expect(mine.map((m) => m.invitationId)).toEqual([body.invitationId]);
  });
  it("未登録の GitHub username は招待でき、メールは送られない", async () => {
    const res = await invite({ githubId: `nobody-${uniq()}` });
    expect(res.status).toBe(201);
    expect(sendSpy).not.toHaveBeenCalled();
  });
  it("保留中の重複した招待は 409", async () => {
    const u = await createInvitee();
    expect((await invite({ email: u.email })).status).toBe(201);
    const res = await invite({ email: u.email });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "すでに招待しています" });
    const gh = `nobody-${uniq()}`;
    expect((await invite({ githubId: gh })).status).toBe(201);
    expect((await invite({ githubId: gh.toUpperCase() })).status).toBe(409);
  });
  it("すでにメンバーの人は 409", async () => {
    const res = await invite({ email: p.members[0]!.email });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "すでにプロダクトのメンバーです" });
  });
  it("自分自身は 400", async () => {
    const res = await invite({ email: p.leader.email });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "自分自身は招待できません" });
  });
  it("拒否された後は、もう一度招待できる", async () => {
    const u = await createInvitee();
    const first = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    expect((await reject(first.invitationId, u.cookie)).status).toBe(200);
    expect((await invite({ email: u.email })).status).toBe(201);
  });
});

describe("招待一覧取得 GET /api/invitation", () => {
  it("cookie なしは 401", async () => {
    expect((await request("GET", "/api/invitation")).status).toBe(401);
  });
  it("保留中の招待だけが、プロダクト名とリーダー名つきで出る", async () => {
    const u = await createInvitee();
    expect(await (await list(u.cookie)).json()).toEqual([]);

    const a = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    const other = await setupProduct({ members: 0 });
    const resB = await invite({ email: u.email }, other.leader.cookie, other.productId);
    const b = (await resB.json()) as { invitationId: string };
    expect(await (await reject(b.invitationId, u.cookie)).status).toBe(200);

    const res = await list(u.cookie);
    expect(res.status).toBe(200);
    const items = (await res.json()) as Record<string, unknown>[];
    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({
      invitationId: a.invitationId,
      productId: p.productId,
      leaderNames: ["leader"],
    });
    expect(typeof items[0]!.productName).toBe("string");
  });
  it("他人宛ての招待は出ない", async () => {
    const u = await createInvitee();
    const v = await createInvitee();
    await invite({ email: u.email });
    expect(await (await list(v.cookie)).json()).toEqual([]);
  });
});

describe("招待承認 POST /api/invitation/:id/accept", () => {
  it("cookie なしは 401", async () => {
    expect((await accept(crypto.randomUUID())).status).toBe(401);
  });
  it("存在しない招待は 404、UUID でない値は 422", async () => {
    const u = await createInvitee();
    const res = await accept(crypto.randomUUID(), u.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "招待が見つかりません" });
    expect((await accept("abc", u.cookie)).status).toBe(422);
  });
  it("承認するとメンバーになり、GET /api/product で見られる。もう一度は 409", async () => {
    const u = await createInvitee();
    const inv = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    expect(await productIds(u.cookie)).not.toContain(p.productId);

    const res = await accept(inv.invitationId, u.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ productId: p.productId, role: "member" });
    expect(await productIds(u.cookie)).toContain(p.productId);
    const [m] = await db.select().from(productMembers).where(eq(productMembers.userId, u.userId));
    expect(m!.role).toBe("member");
    const [row] = await db
      .select()
      .from(productInvitations)
      .where(eq(productInvitations.invitationId, inv.invitationId));
    expect(row!.status).toBe("accepted");
    expect(row!.respondedAt).not.toBeNull();

    const again = await accept(inv.invitationId, u.cookie);
    expect(again.status).toBe(409);
    expect(await list(u.cookie).then((r) => r.json())).toEqual([]);
  });
  it("拒否済みの招待は承認できない(409)", async () => {
    const u = await createInvitee();
    const inv = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    expect((await reject(inv.invitationId, u.cookie)).status).toBe(200);
    expect((await accept(inv.invitationId, u.cookie)).status).toBe(409);
    expect(await productIds(u.cookie)).not.toContain(p.productId);
  });
  it("他人宛ての招待は 404 で、承認できない", async () => {
    const u = await createInvitee();
    const v = await createInvitee();
    const inv = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    expect((await accept(inv.invitationId, v.cookie)).status).toBe(404);
    expect((await accept(inv.invitationId, p.leader.cookie)).status).toBe(404);
    expect(await productIds(v.cookie)).not.toContain(p.productId);
  });
  it("未登録で招待された人が、登録後に承認できる", async () => {
    const o = await createOutsider();
    const inv = (await (await invite({ email: o.email })).json()) as { invitationId: string };
    const res = await accept(inv.invitationId, o.cookie);
    expect(res.status).toBe(200);
    expect(await productIds(o.cookie)).toContain(p.productId);
  });
  it("招待のあとでメンバーになっていた場合は 409(招待は承認済みになる)", async () => {
    const u = await createInvitee();
    const inv = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    await db.insert(productMembers).values({ productId: p.productId, userId: u.userId });
    expect((await accept(inv.invitationId, u.cookie)).status).toBe(409);
    const members = await db.select().from(productMembers).where(eq(productMembers.userId, u.userId));
    expect(members.length).toBe(1);
  });
});

describe("招待拒否 POST /api/invitation/:id/reject", () => {
  it("cookie なしは 401", async () => {
    expect((await reject(crypto.randomUUID())).status).toBe(401);
  });
  it("存在しない招待は 404、UUID でない値は 422", async () => {
    const u = await createInvitee();
    expect((await reject(crypto.randomUUID(), u.cookie)).status).toBe(404);
    expect((await reject("abc", u.cookie)).status).toBe(422);
  });
  it("拒否してもメンバーにならない。もう一度は 409", async () => {
    const u = await createInvitee();
    const inv = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    const res = await reject(inv.invitationId, u.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ invitationId: inv.invitationId, status: "declined" });
    expect(await productIds(u.cookie)).not.toContain(p.productId);
    expect((await reject(inv.invitationId, u.cookie)).status).toBe(409);
    expect(await (await list(u.cookie)).json()).toEqual([]);
  });
  it("承認済みの招待は拒否できない(409)", async () => {
    const u = await createInvitee();
    const inv = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    expect((await accept(inv.invitationId, u.cookie)).status).toBe(200);
    expect((await reject(inv.invitationId, u.cookie)).status).toBe(409);
    expect(await productIds(u.cookie)).toContain(p.productId);
  });
  it("他人宛ての招待は 404", async () => {
    const u = await createInvitee();
    const v = await createInvitee();
    const inv = (await (await invite({ email: u.email })).json()) as { invitationId: string };
    expect((await reject(inv.invitationId, v.cookie)).status).toBe(404);
    expect((await list(u.cookie).then((r) => r.json())) as unknown[]).toHaveLength(1);
  });
});
