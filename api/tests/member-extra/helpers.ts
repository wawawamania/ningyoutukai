import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import { productMembers, users } from "../../src/db/schema";
import { memberRoutes } from "../../src/routes/member";
import { productRoutes } from "../../src/routes/product";
import { productTreeRoutes } from "../../src/routes/product-tree";

export {
  cleanup,
  countTasks,
  createOutsider,
  createTaskType,
  findTask,
  insertTask,
  setupProduct,
} from "../task/helpers";

/** メンバー API・プロダクト API・ツリー API をまとめたテスト用アプリ */
const app = new Elysia().use(memberRoutes).use(productRoutes).use(productTreeRoutes);

export function request(
  method: string,
  path: string,
  opts: { cookie?: string; headers?: Record<string, string> } = {}
) {
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  return app.handle(new Request(`http://localhost${path}`, { method, headers }));
}

export const listUrl = (productId: string) => `/api/product/${productId}/member`;
export const itemUrl = (productId: string, memberId: string) =>
  `/api/product/${productId}/member/${memberId}`;

export type MemberJson = {
  productMemberId: string;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  role: string;
};

export const memberKeys = ["avatarUrl", "productMemberId", "role", "userId", "userName"];

export async function setUserName(userId: string, userName: string) {
  await db.update(users).set({ userName }).where(eq(users.userId, userId));
}

export async function setAvatar(userId: string, avatarUrl: string | null) {
  await db.update(users).set({ avatarUrl }).where(eq(users.userId, userId));
}

export async function memberExists(memberId: string) {
  const rows = await db
    .select({ id: productMembers.productMemberId })
    .from(productMembers)
    .where(eq(productMembers.productMemberId, memberId));
  return rows.length > 0;
}
