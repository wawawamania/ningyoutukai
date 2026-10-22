import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { productMembers, products, users } from "../../src/db/schema";
import { mailer } from "../../src/lib/mailer";
import {
  accept,
  cleanup,
  createInvitee,
  createOutsider,
  findInvitation,
  inviteTo,
  list,
  productIds,
  reject,
  request,
  setupProduct,
  uniq,
  type Ctx,
} from "./helpers";

let p: Ctx;
const sendSpy = spyOn(mailer, "send");
const invite = (body: unknown, cookie: string | null = p.leader.cookie, productId = p.productId) =>
  inviteTo(productId, cookie ?? undefined, body);
const idOf = async (res: Response) => ((await res.json()) as { invitationId: string }).invitationId;
const memberRows = (productId: string, userId: string) =>
  db
    .select()
    .from(productMembers)
    .where(and(eq(productMembers.productId, productId), eq(productMembers.userId, userId)));

beforeAll(async () => {
  p = await setupProduct({ members: 2 });
  sendSpy.mockResolvedValue({ ok: true });
});
afterEach(() => sendSpy.mockClear());
afterAll(async () => {
  sendSpy.mockRestore();
  await cleanup();
});

describe("権限の表: 招待の作成", () => {
  it("認証なし 401 / 所属していない人 404 / メンバー 403 / リーダー 201", async () => {
    const outsider = await createOutsider();
    const email = () => ({ email: `perm-${uniq()}@example.com` });
    expect((await invite(email(), null)).status).toBe(401);
    expect((await invite(email(), outsider.cookie)).status).toBe(404);
    expect((await invite(email(), p.members[0]!.cookie)).status).toBe(403);
    expect((await invite(email(), p.members[1]!.cookie)).status).toBe(403);
    expect((await invite(email(), p.leader.cookie)).status).toBe(201);
  });
  it("別のプロダクトのリーダーは、このプロダクトには招待できない(404)", async () => {
    const other = await setupProduct({ members: 0 });
    const res = await invite({ email: `x-${uniq()}@example.com` }, other.leader.cookie);
    expect(res.status).toBe(404);
  });
  it("別のプロダクトではメンバー、このプロダクトではリーダー、の人は、このプロダクトにだけ招待できる", async () => {
    const other = await setupProduct({ members: 0 });
    const u = await createInvitee();
    // u を other のメンバーにし、p のリーダーではないことを確かめる
    await db.insert(productMembers).values({ productId: other.productId, userId: u.userId });
    expect((await invite({ email: `a-${uniq()}@example.com` }, u.cookie, p.productId)).status).toBe(404);
    expect((await invite({ email: `a-${uniq()}@example.com` }, u.cookie, other.productId)).status).toBe(403);
  });
  it("拒否・失敗した招待は、招待を作らず、メールも送らない", async () => {
    const outsider = await createOutsider();
    await invite({ email: `a-${uniq()}@example.com` }, p.members[0]!.cookie);
    await invite({ email: `a-${uniq()}@example.com` }, outsider.cookie);
    await invite({ email: "bad" });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("権限の表: 一覧・承認・拒否", () => {
  it("認証なしは 401。招待を受けた人だけが一覧・承認・拒否できる", async () => {
    const u = await createInvitee();
    const stranger = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    expect((await list(undefined)).status).toBe(401);
    expect((await accept(id, undefined)).status).toBe(401);
    expect((await reject(id, undefined)).status).toBe(401);
    // 他人(無関係のユーザー・プロダクトのメンバー・リーダー)
    for (const cookie of [stranger.cookie, p.members[0]!.cookie, p.leader.cookie]) {
      expect(((await (await list(cookie)).json()) as unknown[]).length).toBe(0);
      expect((await accept(id, cookie)).status).toBe(404);
      expect((await reject(id, cookie)).status).toBe(404);
    }
    expect((await findInvitation(id))!.status).toBe("pending");
    expect((await accept(id, u.cookie)).status).toBe(200);
  });
  it("存在しない招待と他人宛ての招待は、同じ 404 の本文(存在の有無を漏らさない)", async () => {
    const u = await createInvitee();
    const stranger = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    const other = await accept(id, stranger.cookie);
    const missing = await accept(crypto.randomUUID(), stranger.cookie);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual(await missing.json());
  });
});

describe("状態遷移", () => {
  it("保留中 → 承認 → 承認 / 拒否 はどちらも 409(状態は変わらない)", async () => {
    const u = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    expect((await accept(id, u.cookie)).status).toBe(200);
    const before = await findInvitation(id);
    for (const op of [accept, reject]) {
      const res = await op(id, u.cookie);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ message: "この招待にはすでに回答済みです" });
    }
    const after = await findInvitation(id);
    expect(after!.status).toBe("accepted");
    expect(after!.respondedAt!.getTime()).toBe(before!.respondedAt!.getTime());
    expect((await memberRows(p.productId, u.userId)).length).toBe(1);
  });
  it("保留中 → 拒否 → 承認 / 拒否 はどちらも 409(メンバーにならない)", async () => {
    const u = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    expect((await reject(id, u.cookie)).status).toBe(200);
    expect((await accept(id, u.cookie)).status).toBe(409);
    expect((await reject(id, u.cookie)).status).toBe(409);
    expect((await findInvitation(id))!.status).toBe("declined");
    expect((await memberRows(p.productId, u.userId)).length).toBe(0);
  });
  it("拒否後に再招待でき、新しい招待を承認できる。古い招待は拒否済みのまま", async () => {
    const u = await createInvitee();
    const first = await idOf(await invite({ email: u.email }));
    await reject(first, u.cookie);
    const second = await idOf(await invite({ email: u.email }));
    expect(second).not.toBe(first);
    expect((await accept(first, u.cookie)).status).toBe(409);
    expect((await accept(second, u.cookie)).status).toBe(200);
    expect((await findInvitation(first))!.status).toBe("declined");
  });
  it("承認後(メンバーのうち)の再招待は 409", async () => {
    const u = await createInvitee();
    await accept(await idOf(await invite({ email: u.email })), u.cookie);
    const res = await invite({ email: u.email });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "すでにプロダクトのメンバーです" });
  });
  it("メンバーが外された後の再招待は成功し、もう一度参加できる", async () => {
    const u = await createInvitee();
    await accept(await idOf(await invite({ email: u.email })), u.cookie);
    await db
      .delete(productMembers)
      .where(and(eq(productMembers.productId, p.productId), eq(productMembers.userId, u.userId)));
    expect(await productIds(u.cookie)).not.toContain(p.productId);
    const again = await invite({ email: u.email });
    expect(again.status).toBe(201);
    expect((await accept(await idOf(again), u.cookie)).status).toBe(200);
    expect(await productIds(u.cookie)).toContain(p.productId);
    expect((await memberRows(p.productId, u.userId)).length).toBe(1);
  });
  it("承認で付くロールは必ず member(リーダーにはならない)", async () => {
    const u = await createInvitee();
    await accept(await idOf(await invite({ email: u.email })), u.cookie);
    expect((await memberRows(p.productId, u.userId))[0]!.role).toBe("member");
  });
  it("承認済み・拒否済みの招待は一覧に出ない。respondedAt は ISO 文字列で記録される", async () => {
    const u = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    const res = await reject(id, u.cookie);
    const body = (await res.json()) as { respondedAt: string; createdAt: string; status: string };
    expect(body.status).toBe("declined");
    expect(new Date(body.respondedAt).toISOString()).toBe(body.respondedAt);
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
    expect(await (await list(u.cookie)).json()).toEqual([]);
  });
});

describe("招待先の解決", () => {
  it("GitHub username の大文字・小文字が違っても、登録済みの人を見つけて招待できる", async () => {
    const gh = `OctoCat-${uniq()}`;
    const u = await createInvitee(gh);
    for (const variant of [gh.toUpperCase(), gh.toLowerCase()]) {
      const res = await invite({ githubId: variant });
      if (variant === gh.toUpperCase()) expect(res.status).toBe(201);
      else expect(res.status).toBe(409); // 同じ人への保留中の招待
    }
    const mine = (await (await list(u.cookie)).json()) as unknown[];
    expect(mine.length).toBe(1);
  });
  it("メールで招待された登録済みの人に、GitHub username でも招待しようとすると 409(同じ人の重複)", async () => {
    const gh = `dup-${uniq()}`;
    const u = await createInvitee(gh);
    expect((await invite({ email: u.email })).status).toBe(201);
    expect((await invite({ githubId: gh })).status).toBe(409);
  });
  it("GitHub username で招待された人に、メールでも招待しようとすると 409", async () => {
    const gh = `dup-${uniq()}`;
    const u = await createInvitee(gh);
    expect((await invite({ githubId: gh })).status).toBe(201);
    expect((await invite({ email: u.email })).status).toBe(409);
  });
  it("すでにメンバーの人は、GitHub username で招待しても 409", async () => {
    const gh = `member-${uniq()}`;
    await db.update(users).set({ githubId: gh }).where(eq(users.email, p.members[1]!.email));
    const res = await invite({ githubId: gh.toUpperCase() });
    expect(res.status).toBe(409);
  });
  it("自分自身を GitHub username で招待しても 400", async () => {
    const gh = `self-${uniq()}`;
    await db.update(users).set({ githubId: gh }).where(eq(users.email, p.leader.email));
    const res = await invite({ githubId: gh });
    expect(res.status).toBe(400);
    await db.update(users).set({ githubId: null }).where(eq(users.email, p.leader.email));
  });
  it("自分自身をメールの大文字で招待しても 400", async () => {
    expect((await invite({ email: p.leader.email.toUpperCase() })).status).toBe(400);
  });
  it("未登録のメールで招待された人が、後からそのメールで登録(ログイン)すると、承認できる", async () => {
    const o = await createOutsider();
    const id = await idOf(await invite({ email: o.email.toUpperCase() }));
    const mine = (await (await list(o.cookie)).json()) as { invitationId: string }[];
    expect(mine.map((m) => m.invitationId)).toEqual([id]);
    expect((await accept(id, o.cookie)).status).toBe(200);
    // 承認時に user_id が埋まる
    const [me] = await db.select().from(users).where(eq(users.email, o.email));
    expect((await findInvitation(id))!.userId).toBe(me!.userId);
  });
  it("未登録の GitHub username で招待された人が、後からその username で登録すると、届く(大文字小文字は無視)", async () => {
    const gh = `later-${uniq()}`;
    const id = await idOf(await invite({ githubId: gh.toUpperCase() }));
    const u = await createInvitee();
    expect(((await (await list(u.cookie)).json()) as unknown[]).length).toBe(0);
    await db.update(users).set({ githubId: gh }).where(eq(users.userId, u.userId));
    const mine = (await (await list(u.cookie)).json()) as { invitationId: string }[];
    expect(mine.map((m) => m.invitationId)).toEqual([id]);
    expect((await accept(id, u.cookie)).status).toBe(200);
  });
  it("登録済みの人は、招待のあとで GitHub username を変えても、その招待を承認できる(user_id で結びつく)", async () => {
    const gh = `rename-${uniq()}`;
    const u = await createInvitee(gh);
    const id = await idOf(await invite({ githubId: gh }));
    await db.update(users).set({ githubId: `renamed-${uniq()}` }).where(eq(users.userId, u.userId));
    expect((await accept(id, u.cookie)).status).toBe(200);
  });
  it("未登録のまま招待された人宛ての招待は、メールが同じでも別のメールの人には見えない", async () => {
    const o = await createOutsider();
    const other = await createOutsider();
    const id = await idOf(await invite({ email: o.email }));
    expect(((await (await list(other.cookie)).json()) as unknown[]).length).toBe(0);
    expect((await accept(id, other.cookie)).status).toBe(404);
  });
});

describe("データの分離と応答の形", () => {
  it("他のプロダクトの招待は、そのプロダクト分だけ一覧に出る。応答は決まったフィールドだけ", async () => {
    const other = await setupProduct({ members: 0 });
    const u = await createInvitee();
    const a = await idOf(await invite({ email: u.email }));
    const b = await idOf(await invite({ email: u.email }, other.leader.cookie, other.productId));
    const items = (await (await list(u.cookie)).json()) as Record<string, unknown>[];
    expect(items.map((i) => i.invitationId).sort()).toEqual([a, b].sort());
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ["createdAt", "invitationId", "leaderNames", "productId", "productName"].sort()
      );
      expect(new Date(item.createdAt as string).toISOString()).toBe(item.createdAt as string);
    }
    // 他人のメール・user_id は、どこにも出ない
    const text = JSON.stringify(items);
    expect(text).not.toContain(u.email);
    expect(text).not.toContain(u.userId);
    expect(text).not.toContain(p.leader.email);
  });
  it("一覧は新しい順", async () => {
    const u = await createInvitee();
    const prods = [await setupProduct({ members: 0 }), await setupProduct({ members: 0 }), await setupProduct({ members: 0 })];
    const ids: string[] = [];
    for (const pr of prods) {
      ids.push(await idOf(await invite({ email: u.email }, pr.leader.cookie, pr.productId)));
      await Bun.sleep(5);
    }
    const items = (await (await list(u.cookie)).json()) as { invitationId: string }[];
    expect(items.map((i) => i.invitationId)).toEqual([...ids].reverse());
  });
  it("leaderNames: リーダーが複数いれば全員(名前順)、メンバーは含まない", async () => {
    const pr = await setupProduct({ members: 1 });
    const second = await createInvitee();
    await db.insert(productMembers).values({ productId: pr.productId, userId: second.userId, role: "leader" });
    await db.update(users).set({ userName: "aaa-first" }).where(eq(users.userId, second.userId));
    const u = await createInvitee();
    await invite({ email: u.email }, pr.leader.cookie, pr.productId);
    const items = (await (await list(u.cookie)).json()) as { leaderNames: string[] }[];
    expect(items[0]!.leaderNames).toEqual(["aaa-first", "leader"]);
  });
  it("プロダクト名が応答に入る(HTML 風の名前もそのまま文字列として返る)", async () => {
    const name = `<script>alert(1)</script>${uniq()}`;
    await db.update(products).set({ productName: name }).where(eq(products.productId, p.productId));
    const u = await createInvitee();
    await invite({ email: u.email });
    const items = (await (await list(u.cookie)).json()) as { productName: string }[];
    expect(items[0]!.productName).toBe(name);
  });
  it("承認の応答は、プロダクトの情報と role だけ(招待相手や他メンバーの情報を含まない)", async () => {
    const u = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    const body = (await (await accept(id, u.cookie)).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["createdAt", "productId", "productName", "role"]);
  });
  it("拒否の応答には、招待先として入力した値が入る(本人宛ての応答なので問題ない)が、user_id は含まない", async () => {
    const u = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    const text = JSON.stringify(await (await reject(id, u.cookie)).json());
    expect(text).not.toContain(u.userId);
  });
  it("招待が作られたプロダクトが消えると、招待も消える(一覧に出ない・承認は 404)", async () => {
    const pr = await setupProduct({ members: 0 });
    const u = await createInvitee();
    const id = await idOf(await invite({ email: u.email }, pr.leader.cookie, pr.productId));
    await db.delete(products).where(eq(products.productId, pr.productId));
    expect(await (await list(u.cookie)).json()).toEqual([]);
    expect((await accept(id, u.cookie)).status).toBe(404);
  });
});

describe("エラーの形式", () => {
  it("すべての業務エラーの本文は { message: 日本語 }", async () => {
    const u = await createInvitee();
    const outsider = await createOutsider();
    const id = await idOf(await invite({ email: u.email }));
    await reject(id, u.cookie);
    const responses: Response[] = [
      await invite({ email: "a@example.com" }, null),
      await invite({ email: "a@example.com" }, outsider.cookie),
      await invite({ email: "a@example.com" }, p.members[0]!.cookie),
      await invite({}),
      await invite({ email: p.leader.email }),
      await invite({ email: p.members[0]!.email }),
      await invite({ email: "a@example.com", githubId: "x" }),
      await invite("not-an-object"),
      await accept(id, u.cookie),
      await reject(id, u.cookie),
      await accept(crypto.randomUUID(), u.cookie),
      await accept("abc", u.cookie),
      await reject("abc", u.cookie),
      await accept(id, undefined),
      await list(undefined),
      await request("POST", `/api/invitation/${id}/accept`, { cookie: u.cookie, rawBody: "{bad" }),
    ];
    for (const res of responses) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(["message"]);
      expect(String(body.message)).toMatch(/[぀-ヿ一-鿿]/);
    }
  });
});
