import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import { productMembers } from "../../src/db/schema";
import { productTreeRoutes } from "../../src/routes/product-tree";
import { taskRoutes } from "../../src/routes/task";
import { deleteTaskRoutes } from "../../src/routes/task/delete-task";

/** タスク削除の追加テスト用の共通ヘルパー */

// 削除 API と、削除後の確認に使う取得・更新系 API をまとめたアプリ
const app = new Elysia().use(taskRoutes).use(deleteTaskRoutes).use(productTreeRoutes);

export function call(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  );
}

export const taskPath = (productId: string, taskId: string) =>
  `/api/product/${productId}/task/${taskId}`;

/** メンバーをプロダクトから外す(product_members の行を削除。紐づくタスクも cascade で消える) */
export async function removeMember(memberId: string) {
  await db.delete(productMembers).where(eq(productMembers.productMemberId, memberId));
}

/** メンバーをリーダーに昇格させる(リーダーを複数にするため) */
export async function promoteToLeader(memberId: string) {
  await db
    .update(productMembers)
    .set({ role: "leader" })
    .where(eq(productMembers.productMemberId, memberId));
}

export async function findMember(memberId: string) {
  const [row] = await db
    .select()
    .from(productMembers)
    .where(eq(productMembers.productMemberId, memberId));
  return row;
}
