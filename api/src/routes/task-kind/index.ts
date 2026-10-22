import { Elysia } from "elysia";
import { createTaskKind } from "./create-task-kind";
import { deleteTaskKind } from "./delete-task-kind";
import { listTaskKinds } from "./list-task-kinds";
import { updateTaskKind } from "./update-task-kind";

/**
 * タスクの種類の API(docs/api.md「タスクの種類」)。
 * エンドポイントごとにファイルを分けている。
 */
export const taskKindRoutes = new Elysia({ name: "task-kind-routes" })
  .use(createTaskKind)
  .use(listTaskKinds)
  .use(updateTaskKind)
  .use(deleteTaskKind);
