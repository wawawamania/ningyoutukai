import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { taskTypes } from "../../src/db/schema";
import { cleanup, createOutsider, request, setupProduct } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let other: Ctx;

beforeAll(async () => {
  p = await setupProduct();
  other = await setupProduct();
});
afterAll(cleanup);

const url = (productId = p.productId) => `/api/product/${productId}/task_kinds`;
const post = (body: unknown, cookie = p.leader.cookie, productId = p.productId) =>
  request("POST", url(productId), { cookie, body });
const count = async (productId = p.productId) =>
  (await db.select().from(taskTypes).where(eq(taskTypes.productId, productId))).length;

describe("認証・権限", () => {
  it("cookie なしは 401", async () => {
    expect((await request("POST", url(), { body: { taskTypeName: "A" } })).status).toBe(401);
  });
  it("所属していないユーザーは 404", async () => {
    const o = await createOutsider();
    const res = await post({ taskTypeName: "A" }, o.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });
  it("存在しないプロダクトは 404", async () => {
    expect((await post({ taskTypeName: "A" }, p.leader.cookie, crypto.randomUUID())).status).toBe(404);
  });
  it("UUID でないプロダクト ID は 422", async () => {
    expect((await post({ taskTypeName: "A" }, p.leader.cookie, "abc")).status).toBe(422);
  });
  it("メンバーは 403 で何も作られない", async () => {
    const before = await count();
    const res = await post({ taskTypeName: "メンバー作成" }, p.members[0]!.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
    expect(await count()).toBe(before);
  });
});

describe("追加", () => {
  it("リーダーは 201 で種類を作れる", async () => {
    const res = await post({ taskTypeName: "デザイン" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.taskTypeName).toBe("デザイン");
    expect(json.productId).toBe(p.productId);
    const [row] = await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, json.taskTypeId));
    expect(row?.taskTypeName).toBe("デザイン");
  });
  it("前後の空白は取り除かれる", async () => {
    const res = await post({ taskTypeName: "  コーディング \n" });
    expect(res.status).toBe(201);
    expect((await res.json()).taskTypeName).toBe("コーディング");
  });
  it("空・空白だけは 400", async () => {
    for (const name of ["", "   ", "\t\n"]) {
      const res = await post({ taskTypeName: name });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: "種類の名前を入力してください" });
    }
  });
  it("名前がない・文字列でないは 422", async () => {
    expect((await post({})).status).toBe(422);
    expect((await post({ taskTypeName: 1 })).status).toBe(422);
  });
  it("長さの上限(50 文字)は通り、超えると 422", async () => {
    expect((await post({ taskTypeName: "あ".repeat(50) })).status).toBe(201);
    expect((await post({ taskTypeName: "あ".repeat(51) })).status).toBe(422);
  });
  it("NUL 文字を含む入力は拒否される", async () => {
    const before = await count();
    const res = await post({ taskTypeName: "a\u0000b" });
    expect(res.status).toBe(422);
    expect(await count()).toBe(before);
  });
  it("同じプロダクトの同名は 409(空白違いも同名)", async () => {
    expect((await post({ taskTypeName: "テスト" })).status).toBe(201);
    const res = await post({ taskTypeName: " テスト " });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "同じ名前のタスクの種類がすでにあります" });
  });
  it("別のプロダクトなら同名でも成功", async () => {
    expect((await post({ taskTypeName: "共通名" })).status).toBe(201);
    expect((await post({ taskTypeName: "共通名" }, other.leader.cookie, other.productId)).status).toBe(201);
  });
});
