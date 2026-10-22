import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/db";
import {
  productInvitations,
  productMembers,
  products,
  taskTypes,
  tasks,
  users,
} from "../../src/db/schema";
import { cleanup, createTaskType, insertTask, setupProduct } from "../task/helpers";
import { del, get, list, patch } from "./helpers";

afterAll(cleanup);

async function addInvitation(productId: string, userId?: string) {
  const [inv] = await db
    .insert(productInvitations)
    .values({
      productId,
      userId,
      inviteeIdentifier: `extra-invitee-${crypto.randomUUID()}@example.com`,
      inviteeType: "gmail",
    })
    .returning();
  return inv;
}

describe("PATCH の応答と副作用", () => {
  test("応答のキーは productId / productName / createdAt / role だけ", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId, leader.cookie, { productName: "形の確認" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["createdAt", "productId", "productName", "role"]);
    expect(typeof json.createdAt).toBe("string");
    expect(new Date(json.createdAt).toISOString()).toBe(json.createdAt);
  });

  test("GET と同じ形・同じ値を返し、createdAt と productId は変わらない", async () => {
    const { productId, leader } = await setupProduct();
    const before = await (await get(productId, leader.cookie)).json();
    const res = await patch(productId, leader.cookie, { productName: "変更後" });
    const json = await res.json();
    expect(json).toEqual({ ...before, productName: "変更後" });
    expect(await (await get(productId, leader.cookie)).json()).toEqual(json);
  });

  test("同じ名前での PATCH を 2 回送っても、同じ結果(冪等)", async () => {
    const { productId, leader } = await setupProduct();
    const a = await (await patch(productId, leader.cookie, { productName: "同じ" })).json();
    const b = await (await patch(productId, leader.cookie, { productName: "同じ" })).json();
    expect(b).toEqual(a);
  });

  test("元と同じ名前に変更しても 200", async () => {
    const { productId, leader } = await setupProduct();
    const before = await (await get(productId, leader.cookie)).json();
    const res = await patch(productId, leader.cookie, { productName: before.productName });
    expect(res.status).toBe(200);
  });

  test("別のプロダクトの名前は変わらない", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    const beforeB = await (await get(b.productId, b.leader.cookie)).json();
    await patch(a.productId, a.leader.cookie, { productName: "A だけ" });
    expect(await (await get(b.productId, b.leader.cookie)).json()).toEqual(beforeB);
  });

  test("同じ名前のプロダクトが複数あっても、対象の 1 件だけが変わる", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    await patch(a.productId, a.leader.cookie, { productName: "重複名" });
    await patch(b.productId, b.leader.cookie, { productName: "重複名" });
    await patch(a.productId, a.leader.cookie, { productName: "重複名・改" });
    expect((await (await get(b.productId, b.leader.cookie)).json()).productName).toBe("重複名");
  });

  test("同時に別の名前で PATCH しても、どちらかの名前で整合して 200", async () => {
    const { productId, leader } = await setupProduct();
    const names = Array.from({ length: 8 }, (_, i) => `並行${i}`);
    const results = await Promise.all(names.map((n) => patch(productId, leader.cookie, { productName: n })));
    expect(results.map((r) => r.status)).toEqual(names.map(() => 200));
    const final = (await (await get(productId, leader.cookie)).json()).productName;
    expect(names).toContain(final);
  });

  test("PATCH はメンバー・招待・タスクに影響しない", async () => {
    const { productId, leader, members } = await setupProduct();
    const type = await createTaskType(productId);
    const task = await insertTask(members[0].memberId, { taskTypeId: type.taskTypeId });
    const inv = await addInvitation(productId);
    await patch(productId, leader.cookie, { productName: "副作用なし" });
    expect(
      await db.select().from(productMembers).where(eq(productMembers.productId, productId))
    ).toHaveLength(3);
    expect(
      await db.select().from(productInvitations).where(eq(productInvitations.invitationId, inv.invitationId))
    ).toHaveLength(1);
    expect(await db.select().from(tasks).where(eq(tasks.taskId, task.taskId))).toHaveLength(1);
  });

  test("一覧(GET /api/product)にも変更後の名前が出る", async () => {
    const { productId, leader } = await setupProduct();
    await patch(productId, leader.cookie, { productName: "一覧に反映" });
    const rows = await (await list(leader.cookie)).json();
    expect(rows.find((r: any) => r.productId === productId).productName).toBe("一覧に反映");
  });
});

describe("DELETE の応答と副作用", () => {
  test("204 の本文は空で、Content-Type に JSON を付けない", async () => {
    const { productId, leader } = await setupProduct();
    const res = await del(productId, leader.cookie);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  test("削除したプロダクトは一覧から消え、ほかのプロダクトは残る", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    // 同じユーザー(a のリーダー)を b にも参加させる
    await db
      .insert(productMembers)
      .values({ productId: b.productId, userId: a.leader.userId, role: "member" });
    const before = await (await list(a.leader.cookie)).json();
    expect(before.map((r: any) => r.productId).sort()).toEqual([a.productId, b.productId].sort());

    expect((await del(a.productId, a.leader.cookie)).status).toBe(204);
    const after = await (await list(a.leader.cookie)).json();
    expect(after.map((r: any) => r.productId)).toEqual([b.productId]);
    // メンバーの一覧からも消える
    const memberList = await (await list(a.members[0].cookie)).json();
    expect(memberList).toEqual([]);
  });

  test("削除後の PATCH / GET / DELETE は 404(日本語の { message })", async () => {
    const { productId, leader, members } = await setupProduct();
    expect((await del(productId, leader.cookie)).status).toBe(204);
    for (const cookie of [leader.cookie, members[0].cookie]) {
      const p = await patch(productId, cookie, { productName: "復活" });
      expect(p.status).toBe(404);
      expect(await p.json()).toEqual({ message: "プロダクトが見つかりません" });
      expect((await get(productId, cookie)).status).toBe(404);
      expect((await del(productId, cookie)).status).toBe(404);
    }
    expect(await db.select().from(products).where(eq(products.productId, productId))).toHaveLength(0);
  });

  test("招待(product_invitations)が DB から消える。招待された側のユーザーは残る", async () => {
    const { productId, leader } = await setupProduct();
    const [invitee] = await db
      .insert(users)
      .values({ userName: "invitee", email: `extra-invitee-${crypto.randomUUID()}@example.com` })
      .returning();
    const withUser = await addInvitation(productId, invitee.userId);
    const noUser = await addInvitation(productId);
    expect((await del(productId, leader.cookie)).status).toBe(204);
    expect(
      await db
        .select()
        .from(productInvitations)
        .where(inArray(productInvitations.invitationId, [withUser.invitationId, noUser.invitationId]))
    ).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.userId, invitee.userId))).toHaveLength(1);
    await db.delete(users).where(eq(users.userId, invitee.userId));
  });

  test("メンバーのユーザー自身(users)は消えない", async () => {
    const { productId, leader, members } = await setupProduct();
    await del(productId, leader.cookie);
    const rows = await db
      .select()
      .from(users)
      .where(inArray(users.userId, [leader.userId, members[0].userId, members[1].userId]));
    expect(rows).toHaveLength(3);
  });

  test("複数のタスク・タスク種類をもつプロダクトも、すべて消える", async () => {
    const { productId, leader, members } = await setupProduct();
    const types = [await createTaskType(productId), await createTaskType(productId)];
    const made = [];
    for (const m of [leader, ...members]) {
      for (const t of types) made.push(await insertTask(m.memberId, { taskTypeId: t.taskTypeId }));
    }
    expect((await del(productId, leader.cookie)).status).toBe(204);
    expect(
      await db.select().from(tasks).where(inArray(tasks.taskId, made.map((t) => t.taskId)))
    ).toHaveLength(0);
    expect(
      await db.select().from(taskTypes).where(inArray(taskTypes.taskTypeId, types.map((t) => t.taskTypeId)))
    ).toHaveLength(0);
  });

  test("失敗(403 / 404 / 422)した DELETE では、何も消えない", async () => {
    const { productId, leader, members } = await setupProduct();
    const type = await createTaskType(productId);
    const task = await insertTask(members[0].memberId, { taskTypeId: type.taskTypeId });
    const inv = await addInvitation(productId);
    await del(productId, members[0].cookie);
    await del("not-a-uuid", leader.cookie);
    await del(crypto.randomUUID(), leader.cookie);
    expect(await db.select().from(products).where(eq(products.productId, productId))).toHaveLength(1);
    expect(await db.select().from(tasks).where(eq(tasks.taskId, task.taskId))).toHaveLength(1);
    expect(
      await db.select().from(productInvitations).where(eq(productInvitations.invitationId, inv.invitationId))
    ).toHaveLength(1);
    expect(
      await db.select().from(productMembers).where(eq(productMembers.productId, productId))
    ).toHaveLength(3);
  });

  test("同時に DELETE を 2 回送ると、204 が 1 回と 404 が 1 回", async () => {
    const { productId, leader } = await setupProduct();
    const rs = await Promise.all([del(productId, leader.cookie), del(productId, leader.cookie)]);
    expect(rs.map((r) => r.status).sort()).toEqual([204, 404]);
  });

  test("同時に PATCH と DELETE を送っても、500 にならず、最終的にプロダクトは消える", async () => {
    for (let i = 0; i < 5; i++) {
      const { productId, leader } = await setupProduct();
      const [p, d] = await Promise.all([
        patch(productId, leader.cookie, { productName: `競合${i}` }),
        del(productId, leader.cookie),
      ]);
      expect([200, 404]).toContain(p.status);
      expect(d.status).toBe(204);
      expect(await db.select().from(products).where(eq(products.productId, productId))).toHaveLength(0);
    }
  });
});
