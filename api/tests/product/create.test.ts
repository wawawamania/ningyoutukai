import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanup,
  createProduct,
  createTestUser,
  findMembers,
  findProducts,
  listProducts,
} from "./helpers";

afterAll(cleanup);

let user: Awaited<ReturnType<typeof createTestUser>>;
beforeAll(async () => {
  user = await createTestUser();
});

describe("POST /api/product", () => {
  test("201 とレスポンスの形", async () => {
    const res = await createProduct(user.cookie, { productName: "プロダクトA" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["createdAt", "productId", "productName", "role"]);
    expect(json.productName).toBe("プロダクトA");
    expect(json.role).toBe("leader");
    expect(json.productId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(json.createdAt))).toBe(false);
  });

  test("前後の空白が除去される", async () => {
    const res = await createProduct(user.cookie, { productName: "  \t名前 \n" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.productName).toBe("名前");
    const [row] = await findProducts(json.productId);
    expect(row!.productName).toBe("名前");
  });

  test("空白のみは 400", async () => {
    const res = await createProduct(user.cookie, { productName: "   " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "プロダクト名を入力してください" });
  });

  test("空文字は 400", async () => {
    const res = await createProduct(user.cookie, { productName: "" });
    expect(res.status).toBe(400);
  });

  test("productName 欠落は 422", async () => {
    const res = await createProduct(user.cookie, {});
    expect(res.status).toBe(422);
  });

  test("101 文字は 422", async () => {
    const res = await createProduct(user.cookie, { productName: "a".repeat(101) });
    expect(res.status).toBe(422);
  });

  test("100 文字は 201", async () => {
    const res = await createProduct(user.cookie, { productName: "a".repeat(100) });
    expect(res.status).toBe(201);
    expect((await res.json()).productName).toHaveLength(100);
  });

  test("products と product_members が両方できる(トランザクションの整合)", async () => {
    const res = await createProduct(user.cookie, { productName: "整合" });
    const { productId } = await res.json();
    expect(await findProducts(productId)).toHaveLength(1);
    expect(await findMembers(productId)).toHaveLength(1);
  });

  test("失敗したリクエストでは products も members も作られない", async () => {
    const other = await createTestUser();
    await createProduct(other.cookie, { productName: "   " });
    await createProduct(other.cookie, { productName: "a".repeat(101) });
    expect(await (await listProducts(other.cookie)).json()).toEqual([]);
  });
});
