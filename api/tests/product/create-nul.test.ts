import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, createProduct, createTestUser, listProducts } from "./helpers";

afterAll(cleanup);

let user: Awaited<ReturnType<typeof createTestUser>>;
beforeAll(async () => {
  user = await createTestUser();
});

describe("POST /api/product の NUL 文字", () => {
  for (const [label, productName] of [
    ["先頭", "\u0000ab"],
    ["途中", "a\u0000b"],
    ["末尾", "ab\u0000"],
  ] as const) {
    test(`名前の${label}に NUL を含むと 422 で、プロダクトは作られない`, async () => {
      const before = await (await listProducts(user.cookie)).json();
      const res = await createProduct(user.cookie, { productName });
      expect(res.status).toBe(422);
      const after = await (await listProducts(user.cookie)).json();
      expect(after).toHaveLength(before.length);
    });
  }
});
