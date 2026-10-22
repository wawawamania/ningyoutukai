import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import { productMembers, taskTypes } from "../../src/db/schema";
import { taskKindRoutes } from "../../src/routes/task-kind";
import { request } from "../task-kind/helpers";

const rawApp = new Elysia().use(taskKindRoutes);

/** タスクの種類 API の追加テスト用ヘルパー。 */

export { cleanup, createOutsider, findTask, insertTask, request, setupProduct } from "../task-kind/helpers";

export const kindsUrl = (productId: string) => `/api/product/${productId}/task_kinds`;
export const kindUrl = (productId: string, kindId: string) =>
  `/api/product/${productId}/task_kinds/${kindId}`;

export const post = (productId: string, cookie: string | undefined, body: unknown) =>
  request("POST", kindsUrl(productId), { cookie, body });
export const list = (productId: string, cookie: string | undefined) =>
  request("GET", kindsUrl(productId), { cookie });
export const patch = (productId: string, kindId: string, cookie: string | undefined, body: unknown) =>
  request("PATCH", kindUrl(productId, kindId), { cookie, body });
export const del = (productId: string, kindId: string, cookie: string | undefined) =>
  request("DELETE", kindUrl(productId, kindId), { cookie });

/** 種類を DB に直接作る(名前は指定どおり) */
export async function makeKind(productId: string, taskTypeName: string) {
  const [row] = await db.insert(taskTypes).values({ productId, taskTypeName }).returning();
  return row!.taskTypeId;
}

export async function kindName(kindId: string) {
  const [row] = await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, kindId));
  return row?.taskTypeName;
}

export async function kindNames(productId: string) {
  const rows = await db.select().from(taskTypes).where(eq(taskTypes.productId, productId));
  return rows.map((r) => r.taskTypeName);
}

/** メンバーをプロダクトから外す(削除済みのメンバーを作る) */
export async function removeMember(memberId: string) {
  await db.delete(productMembers).where(eq(productMembers.productMemberId, memberId));
}

/** 生の本文・Content-Type でリクエストする(不正な JSON などの確認用) */
export async function rawPost(
  productId: string,
  cookie: string,
  raw: string,
  contentType?: string
) {
  const headers = new Headers({ cookie });
  if (contentType) headers.set("content-type", contentType);
  return rawApp.handle(
    new Request(`http://localhost${kindsUrl(productId)}`, { method: "POST", headers, body: raw })
  );
}
