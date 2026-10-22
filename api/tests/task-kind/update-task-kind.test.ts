import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { taskTypes } from "../../src/db/schema";
import { cleanup, createOutsider, request, setupProduct } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let other: Ctx;
let kindA: string;
let kindB: string;
let otherKind: string;

async function makeKind(productId: string, name: string) {
  const [row] = await db.insert(taskTypes).values({ productId, taskTypeName: name }).returning();
  return row!.taskTypeId;
}
const nameOf = async (id: string) =>
  (await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, id)))[0]?.taskTypeName;

beforeAll(async () => {
  p = await setupProduct();
  other = await setupProduct();
  kindA = await makeKind(p.productId, "種類A");
  kindB = await makeKind(p.productId, "種類B");
  otherKind = await makeKind(other.productId, "他の種類");
});
afterAll(cleanup);

const url = (kindId: string, productId = p.productId) =>
  `/api/product/${productId}/task_kinds/${kindId}`;
const patch = (kindId: string, body: unknown, cookie = p.leader.cookie, productId = p.productId) =>
  request("PATCH", url(kindId, productId), { cookie, body });

describe("認証・権限", () => {
  it("cookie なしは 401", async () => {
    expect((await request("PATCH", url(kindA), { body: { taskTypeName: "X" } })).status).toBe(401);
  });
  it("所属していないユーザーは 404", async () => {
    const o = await createOutsider();
    expect((await patch(kindA, { taskTypeName: "X" }, o.cookie)).status).toBe(404);
    expect(await nameOf(kindA)).toBe("種類A");
  });
  it("メンバーは 403 で変更されない", async () => {
    const res = await patch(kindA, { taskTypeName: "X" }, p.members[0]!.cookie);
    expect(res.status).toBe(403);
    expect(await nameOf(kindA)).toBe("種類A");
  });
});

describe("編集", () => {
  it("名前が変わり、前後の空白は取り除かれる", async () => {
    const res = await patch(kindA, { taskTypeName: " 新しい種類A " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      taskTypeId: kindA,
      taskTypeName: "新しい種類A",
      productId: p.productId,
    });
    expect(await nameOf(kindA)).toBe("新しい種類A");
  });
  it("自分自身と同じ名前への変更は成功", async () => {
    expect((await patch(kindB, { taskTypeName: "種類B" })).status).toBe(200);
    expect(await nameOf(kindB)).toBe("種類B");
  });
  it("他の種類と同じ名前は 409 で変更されない", async () => {
    const res = await patch(kindB, { taskTypeName: "新しい種類A" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "同じ名前のタスクの種類がすでにあります" });
    expect(await nameOf(kindB)).toBe("種類B");
  });
  it("別のプロダクトの種類で同名にするのは成功", async () => {
    expect((await patch(kindB, { taskTypeName: "他の種類" })).status).toBe(200);
  });
  it("空は 400、長すぎ・NUL 文字は 422", async () => {
    expect((await patch(kindA, { taskTypeName: "  " })).status).toBe(400);
    expect((await patch(kindA, { taskTypeName: "あ".repeat(51) })).status).toBe(422);
    expect((await patch(kindA, { taskTypeName: "a\u0000b" })).status).toBe(422);
    expect(await nameOf(kindA)).toBe("新しい種類A");
  });
  it("別のプロダクトの種類の ID は 404 で変更されない", async () => {
    const res = await patch(otherKind, { taskTypeName: "乗っ取り" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクの種類が見つかりません" });
    expect(await nameOf(otherKind)).toBe("他の種類");
  });
  it("存在しない ID は 404、UUID でない値は 422", async () => {
    expect((await patch(crypto.randomUUID(), { taskTypeName: "X" })).status).toBe(404);
    expect((await patch("abc", { taskTypeName: "X" })).status).toBe(422);
  });
});
