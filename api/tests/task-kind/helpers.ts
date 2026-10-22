import { Elysia } from "elysia";
import { taskKindRoutes } from "../../src/routes/task-kind";

/** タスクの種類 API のテスト用ヘルパー。ユーザー・プロダクトの準備は tests/task/helpers.ts を使う。 */

export { cleanup, createOutsider, insertTask, findTask, setupProduct } from "../task/helpers";

const app = new Elysia().use(taskKindRoutes);

type Opts = { cookie?: string; body?: unknown };

/** タスクの種類 API を呼ぶ。path は `/api/product/...` から始まる絶対パス */
export function request(method: string, path: string, { cookie, body }: Opts = {}) {
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
