import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "../../src/db";
import { taskTypes } from "../../src/db/schema";
import { cleanup, createOutsider, request, setupProduct } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let other: Ctx;

beforeAll(async () => {
  p = await setupProduct();
  other = await setupProduct();
  await db.insert(taskTypes).values([
    { productId: p.productId, taskTypeName: "b-コーディング" },
    { productId: p.productId, taskTypeName: "a-デザイン" },
    { productId: other.productId, taskTypeName: "他プロダクトの種類" },
  ]);
});
afterAll(cleanup);

const url = (productId = p.productId) => `/api/product/${productId}/task_kinds`;

describe("一覧取得", () => {
  it("cookie なしは 401", async () => {
    expect((await request("GET", url())).status).toBe(401);
  });
  it("所属していないユーザーは 404", async () => {
    const o = await createOutsider();
    const res = await request("GET", url(), { cookie: o.cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });
  it("存在しないプロダクトは 404", async () => {
    expect((await request("GET", url(crypto.randomUUID()), { cookie: p.leader.cookie })).status).toBe(404);
  });
  it("UUID でないプロダクト ID は 422", async () => {
    expect((await request("GET", url("abc"), { cookie: p.leader.cookie })).status).toBe(422);
  });
  it("リーダーもメンバーも、名前順の一覧を見られる(他のプロダクトの種類は出ない)", async () => {
    for (const cookie of [p.leader.cookie, p.members[0]!.cookie]) {
      const res = await request("GET", url(), { cookie });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { taskTypeName: string; productId: string }[];
      expect(json.map((k) => k.taskTypeName)).toEqual(["a-デザイン", "b-コーディング"]);
      expect(json.every((k) => k.productId === p.productId)).toBe(true);
    }
  });
  it("種類がないプロダクトは空配列", async () => {
    const empty = await setupProduct({ members: 0 });
    const res = await request("GET", url(empty.productId), { cookie: empty.leader.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
