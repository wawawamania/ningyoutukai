import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { productInvitations, productMembers } from "../../src/db/schema";
import { mailer } from "../../src/lib/mailer";
import {
  accept,
  cleanup,
  createInvitee,
  findInvitation,
  inviteTo,
  invitationsOf,
  reject,
  setupProduct,
  uniq,
  type Ctx,
} from "./helpers";

let p: Ctx;
const sendSpy = spyOn(mailer, "send");
const invite = (body: unknown) => inviteTo(p.productId, p.leader.cookie, body);
const idOf = async (res: Response) => ((await res.json()) as { invitationId: string }).invitationId;
const memberRows = (userId: string) =>
  db
    .select()
    .from(productMembers)
    .where(and(eq(productMembers.productId, p.productId), eq(productMembers.userId, userId)));

beforeAll(async () => {
  p = await setupProduct({ members: 0 });
  sendSpy.mockResolvedValue({ ok: true });
});
afterEach(() => sendSpy.mockClear());
afterAll(async () => {
  sendSpy.mockRestore();
  await cleanup();
});

describe("同時実行: 応答(承認・拒否)", () => {
  it("同じ招待を同時に 5 回承認しても、成功は 1 回だけで、メンバー行は 1 つ", async () => {
    for (let round = 0; round < 3; round++) {
      const u = await createInvitee();
      const id = await idOf(await invite({ email: u.email }));
      const results = await Promise.all(Array.from({ length: 5 }, () => accept(id, u.cookie)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409, 409, 409, 409]);
      expect((await memberRows(u.userId)).length).toBe(1);
      expect((await findInvitation(id))!.status).toBe("accepted");
    }
  });
  it("同じ招待を同時に拒否しても、成功は 1 回だけ", async () => {
    const u = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    const results = await Promise.all(Array.from({ length: 4 }, () => reject(id, u.cookie)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect((await findInvitation(id))!.status).toBe("declined");
    expect((await memberRows(u.userId)).length).toBe(0);
  });
  it("承認と拒否が同時でも、招待の状態とメンバー行が矛盾しない", async () => {
    for (let round = 0; round < 5; round++) {
      const u = await createInvitee();
      const id = await idOf(await invite({ email: u.email }));
      const [a, r] = await Promise.all([accept(id, u.cookie), reject(id, u.cookie)]);
      expect([a.status, r.status].sort()).toEqual([200, 409]);
      const row = await findInvitation(id);
      const members = await memberRows(u.userId);
      if (a.status === 200) {
        expect(row!.status).toBe("accepted");
        expect(members.length).toBe(1);
      } else {
        expect(row!.status).toBe("declined");
        expect(members.length).toBe(0);
      }
    }
  });
  it("未登録のまま招待された人の同時承認でも、成功は 1 回だけ", async () => {
    const u = await createInvitee();
    // 同じ人に、メールと GitHub の別々の招待(user_id は結びつく)を作り、同時に承認する
    const gh = `par-${uniq()}`;
    const first = await idOf(await invite({ email: u.email }));
    // 2 つ目は、DB に直接作って重複させる(API は 409 にするため)
    const [second] = await db
      .insert(productInvitations)
      .values({ productId: p.productId, userId: u.userId, inviteeIdentifier: gh, inviteeType: "github" })
      .returning();
    const results = await Promise.all([accept(first, u.cookie), accept(second!.invitationId, u.cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    // メンバー行は 1 つだけ。両方の招待は「回答済み」になる
    expect((await memberRows(u.userId)).length).toBe(1);
    expect((await findInvitation(first))!.status).toBe("accepted");
    expect((await findInvitation(second!.invitationId))!.status).toBe("accepted");
  });
  it("すでにメンバーの人が承認しようとすると 409 で、招待は承認済みになり、メンバー行は増えない", async () => {
    const u = await createInvitee();
    const id = await idOf(await invite({ email: u.email }));
    await db.insert(productMembers).values({ productId: p.productId, userId: u.userId, role: "leader" });
    expect((await accept(id, u.cookie)).status).toBe(409);
    const rows = await memberRows(u.userId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.role).toBe("leader"); // 既存のロールは上書きされない
  });
});

describe("同時実行: 招待の作成", () => {
  // スキーマに unique 制約がないため、重複チェックと insert の間に隙間がある。実際の挙動を記録する
  it("同じ相手を同時に 2 回招待しても、(少なくとも)全員が 201 か 409 で、5xx にならない", async () => {
    const email = `race-${uniq()}@example.com`;
    const results = await Promise.all(Array.from({ length: 6 }, () => invite({ email })));
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(results.some((r) => r.status === 201)).toBe(true);
  });
  it("別々の相手への同時の招待は、すべて成功する", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => invite({ email: `par-${uniq()}@example.com` }))
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    const all = await invitationsOf(p.productId);
    expect(new Set(all.map((i) => i.invitationId)).size).toBe(all.length);
  });
});
