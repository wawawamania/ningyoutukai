import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { serializeSignedCookie } from "better-call";
import { auth } from "../../src/auth";
import { db } from "../../src/db";
import { productMembers, products, users } from "../../src/db/schema";
import { productRoutes } from "../../src/routes/product";

const app = new Elysia().use(productRoutes);

const BASE = "http://localhost/api/product";

type TestUser = { id: string; email: string; cookie: string };

const created: TestUser[] = [];

async function ctx() {
  return await auth.$context;
}

// better-auth のユーザーとセッションを DB に直接作る(パスワード認証・OAuth には依存しない)
export async function createTestUser(): Promise<TestUser> {
  const { internalAdapter, authCookies, secret } = await ctx();
  const email = `test-${crypto.randomUUID()}@example.com`;
  const user = await internalAdapter.createUser(
    { email, name: "product-test", emailVerified: true },
    { method: "admin" },
  );
  const session = await internalAdapter.createSession(user.id);
  const serialized = await serializeSignedCookie(
    authCookies.sessionToken.name,
    session.token,
    secret,
  );
  const testUser = { id: user.id, email, cookie: serialized.split(";")[0]! };
  created.push(testUser);
  return testUser;
}

// 作成したユーザー・プロダクトを全て削除する(afterAll で呼ぶ)
export async function cleanup() {
  const { internalAdapter } = await ctx();
  const emails = created.map((u) => u.email);
  if (emails.length > 0) {
    const appUsers = await db
      .select({ userId: users.userId })
      .from(users)
      .where(inArray(users.email, emails));
    const appUserIds = appUsers.map((u) => u.userId);
    if (appUserIds.length > 0) {
      const members = await db
        .select({ productId: productMembers.productId })
        .from(productMembers)
        .where(inArray(productMembers.userId, appUserIds));
      const productIds = members.map((m) => m.productId);
      // product_members は cascade で消える
      if (productIds.length > 0) {
        await db.delete(products).where(inArray(products.productId, productIds));
      }
      await db.delete(users).where(inArray(users.userId, appUserIds));
    }
  }
  for (const u of created) {
    // セッション・アカウントは deleteUser が一緒に削除する
    await internalAdapter.deleteUser(u.id);
  }
  created.length = 0;
}

type Opts = { cookie?: string; body?: unknown };

function request(method: string, path: string, { cookie, body }: Opts = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export const createProduct = (cookie: string | undefined, body: unknown) =>
  request("POST", "", { cookie, body });
export const listProducts = (cookie?: string) => request("GET", "", { cookie });
export const getProduct = (cookie: string | undefined, id: string) =>
  request("GET", `/${id}`, { cookie });

// アプリ側 users の行をメールで引く
export async function findAppUsers(email: string) {
  return await db.select().from(users).where(eq(users.email, email));
}

export async function findMembers(productId: string) {
  return await db
    .select()
    .from(productMembers)
    .where(eq(productMembers.productId, productId));
}

export async function findProducts(productId: string) {
  return await db.select().from(products).where(eq(products.productId, productId));
}
