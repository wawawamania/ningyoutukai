import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, createProduct, createTestUser, findAppUsers, listProducts } from "./helpers";

afterAll(cleanup);

describe("アプリ側 users との対応づけ", () => {
  test("初回リクエストでメールに対応する users の行が作られる", async () => {
    const user = await createTestUser();
    expect(await findAppUsers(user.email)).toHaveLength(0);

    await listProducts(user.cookie);

    const rows = await findAppUsers(user.email);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe(user.email);
    expect(rows[0]!.userName).toBe("product-test");
  });

  test("2 回目以降は増えず同じ行を使う", async () => {
    const user = await createTestUser();
    await listProducts(user.cookie);
    const [first] = await findAppUsers(user.email);

    await listProducts(user.cookie);
    await createProduct(user.cookie, { productName: "x" });
    await createProduct(user.cookie, { productName: "y" });

    const rows = await findAppUsers(user.email);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(first!.userId);
  });

  test("同時リクエストでも users の行は 1 つに収束する", async () => {
    const user = await createTestUser();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => listProducts(user.cookie)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await findAppUsers(user.email)).toHaveLength(1);
  });
});
