import { afterAll, expect, test } from "bun:test";
import { cleanup, setupProduct } from "../task/helpers";
import { get, patch } from "./helpers";

afterAll(cleanup);

// 修正済みの不具合の回帰テスト。
// PATCH の名前に NUL 文字(\u0000)を含むと、以前は PostgreSQL が
// `invalid byte sequence for encoding "UTF8": 0x00` (22021) で拒否し、500 になっていた。
// 期待: 400 か 422 で { message }(入力の誤りなので 4xx)。
test("PATCH: 名前に NUL 文字を含むと 500 ではなく 4xx を返す", async () => {
  const { productId, leader } = await setupProduct();
  const before = (await (await get(productId, leader.cookie)).json()).productName;
  const res = await patch(productId, leader.cookie, { productName: "a\u0000b" });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect((await get(productId, leader.cookie).then((r) => r.json())).productName).toBe(before);
});
