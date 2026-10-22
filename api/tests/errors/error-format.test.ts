import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serializeSignedCookie } from "better-call";
import { inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { auth } from "../../src/auth";
import { db } from "../../src/db";
import { productMembers, products, users } from "../../src/db/schema";
import { errorHandler } from "../../src/lib/error-handler";
import { productRoutes } from "../../src/routes/product";

const app = new Elysia().use(errorHandler).use(productRoutes);
const BASE = "http://localhost";

const createdAuthIds: string[] = [];
const createdEmails: string[] = [];
let cookie = "";

beforeAll(async () => {
  const { internalAdapter, authCookies, secret } = await auth.$context;
  const email = `test-${crypto.randomUUID()}@example.com`;
  const user = await internalAdapter.createUser(
    { email, name: "error-format-test", emailVerified: true },
    { method: "admin" },
  );
  createdAuthIds.push(user.id);
  createdEmails.push(email);
  const session = await internalAdapter.createSession(user.id);
  const serialized = await serializeSignedCookie(
    authCookies.sessionToken.name,
    session.token,
    secret,
  );
  cookie = serialized.split(";")[0]!;
});

afterAll(async () => {
  const { internalAdapter } = await auth.$context;
  // アプリ側 users の行(getOrCreateAppUser で作られうる)と所属プロダクトを削除してから auth 側を削除
  if (createdEmails.length > 0) {
    const appUsers = await db
      .select({ userId: users.userId })
      .from(users)
      .where(inArray(users.email, createdEmails));
    const ids = appUsers.map((u) => u.userId);
    if (ids.length > 0) {
      const members = await db
        .select({ productId: productMembers.productId })
        .from(productMembers)
        .where(inArray(productMembers.userId, ids));
      const productIds = members.map((m) => m.productId);
      if (productIds.length > 0) {
        await db.delete(products).where(inArray(products.productId, productIds));
      }
      await db.delete(users).where(inArray(users.userId, ids));
    }
  }
  for (const id of createdAuthIds) await internalAdapter.deleteUser(id);
});

function call(method: string, path: string, init: { cookie?: string; body?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return app.handle(new Request(`${BASE}${path}`, { method, headers, body: init.body }));
}

describe("エラーレスポンスの形式", () => {
  test("検証エラー: 422 で { message } のみ", async () => {
    const res = await call("POST", "/api/product", { cookie, body: "{}" });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(Object.keys(json)).toEqual(["message"]);
    expect(json.message.startsWith("入力が正しくありません")).toBe(true);
    expect(json.message).toContain("productName");
    expect("type" in json).toBe(false);
  });

  test("uuid でないパラメータ: 422 で productId を含む", async () => {
    const res = await call("GET", "/api/product/not-a-uuid", { cookie });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.message).toContain("productId");
    expect("type" in json).toBe(false);
  });

  test("不正な JSON: 400", async () => {
    const res = await call("POST", "/api/product", { cookie, body: "{bad" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "リクエストの形式が正しくありません" });
  });

  test("存在しないルート: 404", async () => {
    const res = await call("GET", "/no/such/route");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "見つかりません" });
  });

  test("想定外のエラー: 500 で内容を漏らさない", async () => {
    const boom = new Elysia().use(errorHandler).get("/boom", () => {
      throw new Error('insert into "secret" values (1)');
    });
    const original = console.error;
    console.error = () => {};
    try {
      const res = await boom.handle(new Request(`${BASE}/boom`));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ message: "サーバーでエラーが発生しました" });
      expect(text).not.toContain("insert into");
    } finally {
      console.error = original;
    }
  });

  test("業務エラー: 未ログインの 401 は従来どおり", async () => {
    const res = await call("GET", "/api/product");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "ログインが必要です" });
  });

  test("業務エラー: 所属外の 404 は従来どおり", async () => {
    const res = await call("GET", `/api/product/${crypto.randomUUID()}`, { cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });

  test("業務エラー: 空白のみのプロダクト名の 400 は従来どおり", async () => {
    const res = await call("POST", "/api/product", {
      cookie,
      body: JSON.stringify({ productName: "   " }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "プロダクト名を入力してください" });
  });
});
