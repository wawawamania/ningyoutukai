import { afterAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { productRoutes } from "../../src/routes/product";
import { productManageRoutes } from "../../src/routes/product-manage";
import { cleanup, setupProduct } from "../task/helpers";

const app = new Elysia().use(productRoutes).use(productManageRoutes);

afterAll(cleanup);

function call(method: string, productId: string, cookie: string, body?: unknown) {
  const headers = new Headers({ cookie });
  if (body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`http://localhost/api/product/${productId}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

describe("PATCH /api/product/:productId の名前に NUL 文字", () => {
  const cases: [string, string][] = [
    ["先頭", "\u0000ab"],
    ["途中", "a\u0000b"],
    ["末尾", "ab\u0000"],
  ];

  for (const [position, productName] of cases) {
    test(`NUL が${position}にあると 422 で、名前は変わらない`, async () => {
      const { productId, leader } = await setupProduct();
      const before = (await (await call("GET", productId, leader.cookie)).json()).productName;

      const res = await call("PATCH", productId, leader.cookie, { productName });
      expect(res.status).toBe(422);

      const after = (await (await call("GET", productId, leader.cookie)).json()).productName;
      expect(after).toBe(before);
    });
  }
});
