import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { taskTypes } from "../../src/db/schema";
import { cleanup, createOutsider, findTask, insertTask, request, setupProduct } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let other: Ctx;

async function makeKind(productId: string, name: string) {
  const [row] = await db
    .insert(taskTypes)
    .values({ productId, taskTypeName: `${name}-${crypto.randomUUID().slice(0, 6)}` })
    .returning();
  return row!.taskTypeId;
}
const exists = async (id: string) =>
  (await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, id))).length === 1;

beforeAll(async () => {
  p = await setupProduct();
  other = await setupProduct();
});
afterAll(cleanup);

const url = (kindId: string, productId = p.productId) =>
  `/api/product/${productId}/task_kinds/${kindId}`;
const del = (kindId: string, cookie = p.leader.cookie, productId = p.productId) =>
  request("DELETE", url(kindId, productId), { cookie });

describe("認証・権限", () => {
  it("cookie なしは 401", async () => {
    const id = await makeKind(p.productId, "k");
    expect((await request("DELETE", url(id))).status).toBe(401);
    expect(await exists(id)).toBe(true);
  });
  it("所属していないユーザーは 404 で消えない", async () => {
    const id = await makeKind(p.productId, "k");
    const o = await createOutsider();
    expect((await del(id, o.cookie)).status).toBe(404);
    expect(await exists(id)).toBe(true);
  });
  it("メンバーは 403 で消えない", async () => {
    const id = await makeKind(p.productId, "k");
    const res = await del(id, p.members[0]!.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
    expect(await exists(id)).toBe(true);
  });
});

describe("削除", () => {
  it("リーダーは 204 で種類を削除できる", async () => {
    const id = await makeKind(p.productId, "k");
    const res = await del(id);
    expect(res.status).toBe(204);
    expect(await exists(id)).toBe(false);
  });
  it("使っていたタスクは残り、task_type_id が null になる(別の種類・別プロダクトのタスクは巻き込まれない)", async () => {
    const id = await makeKind(p.productId, "k");
    const keep = await makeKind(p.productId, "keep");
    const otherId = await makeKind(other.productId, "o");
    const used = await insertTask(p.members[0]!.memberId, { taskTypeId: id });
    const used2 = await insertTask(p.members[1]!.memberId, { taskTypeId: id });
    const keepTask = await insertTask(p.members[0]!.memberId, { taskTypeId: keep });
    const otherTask = await insertTask(other.members[0]!.memberId, { taskTypeId: otherId });

    expect((await del(id)).status).toBe(204);

    expect((await findTask(used.taskId))?.taskTypeId).toBeNull();
    expect((await findTask(used2.taskId))?.taskTypeId).toBeNull();
    expect((await findTask(used.taskId))?.taskName).toBe("テストタスク");
    expect((await findTask(keepTask.taskId))?.taskTypeId).toBe(keep);
    expect((await findTask(otherTask.taskId))?.taskTypeId).toBe(otherId);
    expect(await exists(keep)).toBe(true);
    expect(await exists(otherId)).toBe(true);
  });
  it("別のプロダクトの種類の ID は 404 で消えない", async () => {
    const otherId = await makeKind(other.productId, "o");
    const res = await del(otherId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクの種類が見つかりません" });
    expect(await exists(otherId)).toBe(true);
  });
  it("存在しない ID は 404、UUID でない値は 422", async () => {
    expect((await del(crypto.randomUUID())).status).toBe(404);
    expect((await del("abc")).status).toBe(422);
  });
  it("2 回目の削除は 404", async () => {
    const id = await makeKind(p.productId, "k");
    expect((await del(id)).status).toBe(204);
    expect((await del(id)).status).toBe(404);
  });
});
