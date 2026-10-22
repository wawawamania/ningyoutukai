import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import {
  productInvitations,
  productMembers,
  products,
  taskTypes,
  tasks,
} from "../../src/db/schema";
import { productRoutes } from "../../src/routes/product";
import { productManageRoutes } from "../../src/routes/product-manage";
import {
  cleanup,
  createOutsider,
  createTaskType,
  insertTask,
  setupProduct,
} from "../task/helpers";

const app = new Elysia().use(productRoutes).use(productManageRoutes);

afterAll(cleanup);

function call(method: string, productId: string, cookie?: string, body?: unknown) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`http://localhost/api/product/${productId}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

const patch = (id: string, cookie: string | undefined, body: unknown) =>
  call("PATCH", id, cookie, body);
const del = (id: string, cookie?: string) => call("DELETE", id, cookie);
const get = (id: string, cookie?: string) => call("GET", id, cookie);

describe("PATCH /api/product/:productId", () => {
  test("認証なしは 401", async () => {
    const { productId } = await setupProduct();
    const res = await patch(productId, undefined, { productName: "x" });
    expect(res.status).toBe(401);
  });

  test("リーダーは変更でき、変更後のプロダクトを role 付きで返す", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId, leader.cookie, { productName: "新しい名前" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.productId).toBe(productId);
    expect(json.productName).toBe("新しい名前");
    expect(json.role).toBe("leader");
    expect(json.createdAt).toBeDefined();
  });

  test("変更が GET に反映される", async () => {
    const { productId, leader } = await setupProduct();
    await patch(productId, leader.cookie, { productName: "反映確認" });
    const res = await get(productId, leader.cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).productName).toBe("反映確認");
  });

  test("メンバーは 403 で、名前は変わらない", async () => {
    const { productId, leader, members } = await setupProduct();
    const before = (await (await get(productId, leader.cookie)).json()).productName;
    const res = await patch(productId, members[0].cookie, { productName: "乗っ取り" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
    expect((await (await get(productId, leader.cookie)).json()).productName).toBe(before);
  });

  test("所属していないユーザーは 404", async () => {
    const { productId } = await setupProduct();
    const outsider = await createOutsider();
    const res = await patch(productId, outsider.cookie, { productName: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });

  test("存在しない UUID は 404", async () => {
    const outsider = await createOutsider();
    const res = await patch(crypto.randomUUID(), outsider.cookie, { productName: "x" });
    expect(res.status).toBe(404);
  });

  test("UUID でない値は 422", async () => {
    const outsider = await createOutsider();
    const res = await patch("not-a-uuid", outsider.cookie, { productName: "x" });
    expect(res.status).toBe(422);
  });

  test("空・空白だけの名前は 400", async () => {
    const { productId, leader } = await setupProduct();
    for (const productName of ["", "   "]) {
      const res = await patch(productId, leader.cookie, { productName });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: "プロダクト名を入力してください" });
    }
  });

  test("前後の空白は取り除かれる", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId, leader.cookie, { productName: "  名前  " });
    expect(res.status).toBe(200);
    expect((await res.json()).productName).toBe("名前");
  });

  test("100 文字ちょうどは成功、101 文字は 422", async () => {
    const { productId, leader } = await setupProduct();
    const ok = await patch(productId, leader.cookie, { productName: "あ".repeat(100) });
    expect(ok.status).toBe(200);
    const ng = await patch(productId, leader.cookie, { productName: "あ".repeat(101) });
    expect(ng.status).toBe(422);
  });

  test("productName がないと 422", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId, leader.cookie, {});
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/product/:productId", () => {
  test("認証なしは 401", async () => {
    const { productId } = await setupProduct();
    const res = await del(productId);
    expect(res.status).toBe(401);
  });

  test("メンバーは 403 で、プロダクトは残る", async () => {
    const { productId, leader, members } = await setupProduct();
    const res = await del(productId, members[0].cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
    expect((await get(productId, leader.cookie)).status).toBe(200);
  });

  test("所属していないユーザーは 404 で、プロダクトは残る", async () => {
    const { productId, leader } = await setupProduct();
    const outsider = await createOutsider();
    const res = await del(productId, outsider.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
    expect((await get(productId, leader.cookie)).status).toBe(200);
  });

  test("存在しない UUID は 404", async () => {
    const outsider = await createOutsider();
    expect((await del(crypto.randomUUID(), outsider.cookie)).status).toBe(404);
  });

  test("UUID でない値は 422", async () => {
    const outsider = await createOutsider();
    expect((await del("not-a-uuid", outsider.cookie)).status).toBe(422);
  });

  test("リーダーは 204 で削除でき、削除後の GET は 404", async () => {
    const { productId, leader } = await setupProduct();
    const res = await del(productId, leader.cookie);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect((await get(productId, leader.cookie)).status).toBe(404);
    // 二重に削除しても 404
    expect((await del(productId, leader.cookie)).status).toBe(404);
  });

  test("メンバー・招待・タスク・タスク種類が消え、別のプロダクトのデータは残る", async () => {
    const target = await setupProduct();
    const other = await setupProduct();

    const seed = async (p: typeof target) => {
      const type = await createTaskType(p.productId);
      const task = await insertTask(p.members[0].memberId, { taskTypeId: type.taskTypeId });
      const [inv] = await db
        .insert(productInvitations)
        .values({
          productId: p.productId,
          inviteeIdentifier: `invitee-${crypto.randomUUID()}@example.com`,
          inviteeType: "gmail",
        })
        .returning();
      return { type, task, inv };
    };
    const t1 = await seed(target);
    const o1 = await seed(other);

    const res = await del(target.productId, target.leader.cookie);
    expect(res.status).toBe(204);

    const memberIds = [target.leader, ...target.members].map((m) => m.memberId);
    expect(await db.select().from(products).where(eq(products.productId, target.productId))).toHaveLength(0);
    expect(await db.select().from(productMembers).where(inArray(productMembers.productMemberId, memberIds))).toHaveLength(0);
    expect(await db.select().from(productInvitations).where(eq(productInvitations.invitationId, t1.inv.invitationId))).toHaveLength(0);
    expect(await db.select().from(tasks).where(eq(tasks.taskId, t1.task.taskId))).toHaveLength(0);
    expect(await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, t1.type.taskTypeId))).toHaveLength(0);

    // 別のプロダクトは巻き込まれない
    const otherMemberIds = [other.leader, ...other.members].map((m) => m.memberId);
    expect(await db.select().from(products).where(eq(products.productId, other.productId))).toHaveLength(1);
    expect(await db.select().from(productMembers).where(inArray(productMembers.productMemberId, otherMemberIds))).toHaveLength(3);
    expect(await db.select().from(productInvitations).where(eq(productInvitations.invitationId, o1.inv.invitationId))).toHaveLength(1);
    expect(await db.select().from(tasks).where(eq(tasks.taskId, o1.task.taskId))).toHaveLength(1);
    expect(await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, o1.type.taskTypeId))).toHaveLength(1);
    expect((await get(other.productId, other.leader.cookie)).status).toBe(200);
  });
});
