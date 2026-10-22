import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, createProduct, createTestUser, getProduct } from "./helpers";

afterAll(cleanup);

describe("GET /api/product/:productId", () => {
  test("自分のプロダクトは 200", async () => {
    const user = await createTestUser();
    const created = await (await createProduct(user.cookie, { productName: "mine" })).json();

    const res = await getProduct(user.cookie, created.productId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(created);
  });

  test("他ユーザーのプロダクトは 404", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const { productId } = await (await createProduct(owner.cookie, { productName: "x" })).json();

    const res = await getProduct(other.cookie, productId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });

  test("存在しない uuid は 404", async () => {
    const user = await createTestUser();
    const res = await getProduct(user.cookie, crypto.randomUUID());
    expect(res.status).toBe(404);
  });

  test("uuid でない文字列は 422", async () => {
    const user = await createTestUser();
    const res = await getProduct(user.cookie, "not-a-uuid");
    expect(res.status).toBe(422);
  });
});
