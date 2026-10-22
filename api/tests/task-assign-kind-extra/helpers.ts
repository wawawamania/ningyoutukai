import { Elysia } from "elysia";
import { productTreeRoutes } from "../../src/routes/product-tree";
import { taskRoutes } from "../../src/routes/task";
import { assignKindRoutes } from "../../src/routes/task/assign-kind";

/** 種類の割り当て・タスク API・ツリー API をまとめたアプリ(index.ts の登録と同じ構成) */
export const app = new Elysia()
  .use(taskRoutes)
  .use(assignKindRoutes)
  .use(productTreeRoutes);

export function call(method: string, path: string, cookie?: string, body?: unknown) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

/** 種類の割り当ての URL。各値は文字列そのまま(不正な値の検証用) */
export const assignPath = (productId: string, taskId: string, kindId: string) =>
  `/api/product/${productId}/task/${taskId}/task_kinds/${kindId}`;

export const assign = (
  cookie: string | undefined,
  productId: string,
  taskId: string,
  kindId: string,
  body?: unknown
) => call("PATCH", assignPath(productId, taskId, kindId), cookie, body);
