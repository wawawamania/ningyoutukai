import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, createProduct, createTestUser, getProduct, listProducts } from "./helpers";

afterAll(cleanup);

const UNAUTH = { message: "ログインが必要です" };

describe("プロダクト API の認証", () => {
  test("cookie なしの POST / は 401", async () => {
    const res = await createProduct(undefined, { productName: "x" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTH);
  });

  test("cookie なしの GET / は 401", async () => {
    const res = await listProducts();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTH);
  });

  test("cookie なしの GET /:id は 401", async () => {
    const res = await getProduct(undefined, crypto.randomUUID());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTH);
  });

  test("不正なセッション cookie は 401", async () => {
    const res = await listProducts("better-auth.session_token=invalid.invalid");
    expect(res.status).toBe(401);
  });

  test("有効なセッション cookie なら 401 にならない", async () => {
    const user = await createTestUser();
    const res = await listProducts(user.cookie);
    expect(res.status).toBe(200);
  });
});
