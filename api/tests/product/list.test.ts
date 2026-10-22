import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, createProduct, createTestUser, listProducts } from "./helpers";

afterAll(cleanup);

describe("GET /api/product", () => {
  test("所属なしなら空配列", async () => {
    const user = await createTestUser();
    const res = await listProducts(user.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("自分のプロダクトだけが返り、別ユーザーのものは含まれない", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const { productId: aId } = await (await createProduct(a.cookie, { productName: "A" })).json();
    const { productId: bId } = await (await createProduct(b.cookie, { productName: "B" })).json();

    const listA = await (await listProducts(a.cookie)).json();
    expect(listA).toHaveLength(1);
    expect(listA[0]).toMatchObject({ productId: aId, productName: "A", role: "leader" });
    expect(Object.keys(listA[0]).sort()).toEqual(["createdAt", "productId", "productName", "role"]);

    const listB = await (await listProducts(b.cookie)).json();
    expect(listB.map((p: { productId: string }) => p.productId)).toEqual([bId]);
  });

  test("複数作成した場合は件数分返る", async () => {
    const user = await createTestUser();
    for (const name of ["1", "2", "3"]) {
      await createProduct(user.cookie, { productName: name });
    }
    const list = await (await listProducts(user.cookie)).json();
    expect(list).toHaveLength(3);
    expect(list.map((p: { productName: string }) => p.productName).sort()).toEqual(["1", "2", "3"]);
  });
});
