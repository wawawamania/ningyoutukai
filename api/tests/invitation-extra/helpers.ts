import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import { productInvitations, users } from "../../src/db/schema";
import { invitationRoutes } from "../../src/routes/invitation";
import { productRoutes } from "../../src/routes/product";
import { createOutsider, setupProduct } from "../task/helpers";

export { cleanup, createOutsider, setupProduct } from "../task/helpers";

/** 招待 API のテスト補助(追加テスト用)。既存の tests/task/helpers.ts の上に作る */

const app = new Elysia().use(invitationRoutes).use(productRoutes);

export function request(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; rawBody?: string } = {}
) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.body !== undefined || opts.rawBody !== undefined) {
    headers.set("content-type", "application/json");
  }
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    })
  );
}

export type Ctx = Awaited<ReturnType<typeof setupProduct>>;

export const inviteTo = (productId: string, cookie: string | undefined, body: unknown) =>
  request("POST", `/api/product/${productId}/invitation`, { cookie, body });
export const list = (cookie?: string) => request("GET", "/api/invitation", { cookie });
export const accept = (id: string, cookie?: string) =>
  request("POST", `/api/invitation/${id}/accept`, { cookie });
export const reject = (id: string, cookie?: string) =>
  request("POST", `/api/invitation/${id}/reject`, { cookie });

export const uniq = () => crypto.randomUUID().slice(0, 8);

export async function productIds(cookie: string) {
  const res = await request("GET", "/api/product", { cookie });
  return ((await res.json()) as { productId: string }[]).map((x) => x.productId);
}

/** 登録済み(users の行あり)の別ユーザー。githubId を渡すと GitHub の username も持つ */
export async function createInvitee(githubId?: string) {
  const o = await createOutsider();
  const res = await list(o.cookie); // users の行を作る
  if (res.status !== 200) throw new Error(`createInvitee failed: ${res.status}`);
  if (githubId) {
    await db.update(users).set({ githubId }).where(eq(users.email, o.email));
  }
  const [row] = await db.select().from(users).where(eq(users.email, o.email));
  return { ...o, userId: row!.userId };
}

export async function findInvitation(invitationId: string) {
  const [row] = await db
    .select()
    .from(productInvitations)
    .where(eq(productInvitations.invitationId, invitationId));
  return row;
}

export async function invitationsOf(productId: string) {
  return await db
    .select()
    .from(productInvitations)
    .where(eq(productInvitations.productId, productId));
}

/** auth を通さない users の行を直接作る(addressedTo の単体テスト用)。cleanupRawUsers で消す */
const rawUserIds: string[] = [];
export async function insertRawUser(
  values: { email?: string; githubId?: string | null; userName?: string } = {}
) {
  const [row] = await db
    .insert(users)
    .values({
      userName: values.userName ?? "raw",
      email: values.email ?? `inv-extra-${crypto.randomUUID()}@example.com`,
      githubId: values.githubId ?? null,
    })
    .returning();
  rawUserIds.push(row!.userId);
  return row!;
}
export async function cleanupRawUsers() {
  if (rawUserIds.length > 0) await db.delete(users).where(inArray(users.userId, rawUserIds));
  rawUserIds.length = 0;
}
