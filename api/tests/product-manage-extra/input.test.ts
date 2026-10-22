import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, setupProduct } from "../task/helpers";
import { call, get, patch } from "./helpers";

afterAll(cleanup);

async function nameOf(productId: string, cookie: string) {
  return (await (await get(productId, cookie)).json()).productName as string;
}

describe("PATCH の名前の入力境界", () => {
  test("全角スペースだけは 400 で、名前は変わらない", async () => {
    const { productId, leader } = await setupProduct();
    const before = await nameOf(productId, leader.cookie);
    const res = await patch(productId, leader.cookie, { productName: "　　" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "プロダクト名を入力してください" });
    expect(await nameOf(productId, leader.cookie)).toBe(before);
  });

  test("タブ・改行だけは 400", async () => {
    const { productId, leader } = await setupProduct();
    for (const productName of ["\t", "\n", "\r\n\t "]) {
      const res = await patch(productId, leader.cookie, { productName });
      expect(res.status).toBe(400);
    }
  });

  test("前後の全角スペース・タブ・改行は取り除かれる", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId, leader.cookie, { productName: "　\t名前\n " });
    expect(res.status).toBe(200);
    expect((await res.json()).productName).toBe("名前");
  });

  test("途中の空白は保たれる", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId, leader.cookie, { productName: "a  b　c" });
    expect((await res.json()).productName).toBe("a  b　c");
  });

  test("絵文字(サロゲートペア)・結合文字を含む名前を保存できる", async () => {
    const { productId, leader } = await setupProduct();
    for (const productName of ["🎎人形🎎", "👨‍👩‍👧‍👦家族", "é", "が"]) {
      const res = await patch(productId, leader.cookie, { productName });
      expect(res.status).toBe(200);
      expect((await res.json()).productName).toBe(productName);
      expect(await nameOf(productId, leader.cookie)).toBe(productName);
    }
  });

  test("絵文字 50 個(UTF-16 で 100 単位)は成功する", async () => {
    const { productId, leader } = await setupProduct();
    const productName = "🎎".repeat(50);
    const res = await patch(productId, leader.cookie, { productName });
    expect(res.status).toBe(200);
    expect((await res.json()).productName).toBe(productName);
  });

  test("上限は trim 前の長さで判定される(前後の空白込みで 101 文字は 422)", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId, leader.cookie, { productName: ` ${"あ".repeat(100)}` });
    expect(res.status).toBe(422);
  });

  test("非常に長い文字列(100 万文字)は 422 で、名前は変わらない", async () => {
    const { productId, leader } = await setupProduct();
    const before = await nameOf(productId, leader.cookie);
    const res = await patch(productId, leader.cookie, { productName: "a".repeat(1_000_000) });
    expect(res.status).toBe(422);
    expect(await nameOf(productId, leader.cookie)).toBe(before);
  });

  test("SQL 風・HTML 風の文字列は、そのまま保存される", async () => {
    const { productId, leader } = await setupProduct();
    for (const productName of [
      "'; DROP TABLE products; --",
      "<script>alert(1)</script>",
      "\\' OR 1=1 --",
      "%_",
    ]) {
      const res = await patch(productId, leader.cookie, { productName });
      expect(res.status).toBe(200);
      expect((await res.json()).productName).toBe(productName);
    }
    expect((await get(productId, leader.cookie)).status).toBe(200);
  });

  test("改行を含む名前も保存できる", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId, leader.cookie, { productName: "a\nb" });
    expect(res.status).toBe(200);
    expect((await res.json()).productName).toBe("a\nb");
  });
});

describe("PATCH の本文の型・形", () => {
  test("型が違う productName は 422 で、{ message } は日本語", async () => {
    const { productId, leader } = await setupProduct();
    for (const productName of [123, true, null, ["a"], { a: 1 }]) {
      const res = await patch(productId, leader.cookie, { productName });
      expect(res.status).toBe(422);
      expect((await res.json()).message).toContain("入力が正しくありません");
    }
  });

  test("本文が配列・文字列・null・空オブジェクトは 422", async () => {
    const { productId, leader } = await setupProduct();
    for (const body of [[], "名前", null, {}]) {
      const res = await patch(productId, leader.cookie, body);
      expect(res.status).toBe(422);
    }
  });

  test("本文なしは 4xx で 500 にならない", async () => {
    const { productId, leader } = await setupProduct();
    const res = await call("PATCH", `/api/product/${productId}`, { cookie: leader.cookie });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test("壊れた JSON は 4xx で { message }", async () => {
    const { productId, leader } = await setupProduct();
    const res = await call("PATCH", `/api/product/${productId}`, {
      cookie: leader.cookie,
      raw: '{"productName": ',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(typeof (await res.json()).message).toBe("string");
  });

  test("Content-Type が text/plain でも 500 にならない", async () => {
    const { productId, leader } = await setupProduct();
    const res = await call("PATCH", `/api/product/${productId}`, {
      cookie: leader.cookie,
      raw: JSON.stringify({ productName: "x" }),
      contentType: "text/plain",
    });
    expect(res.status).toBeLessThan(500);
  });

  test("余計なフィールド(productId, createdAt, role)は無視され、変わらない", async () => {
    const { productId, leader } = await setupProduct();
    const before = await (await get(productId, leader.cookie)).json();
    const res = await patch(productId, leader.cookie, {
      productName: "余計あり",
      productId: crypto.randomUUID(),
      createdAt: "2000-01-01T00:00:00.000Z",
      role: "member",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.productId).toBe(productId);
    expect(json.createdAt).toBe(before.createdAt);
    expect(json.role).toBe("leader");
    const after = await (await get(productId, leader.cookie)).json();
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.productName).toBe("余計あり");
  });
});
