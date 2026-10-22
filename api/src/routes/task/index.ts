import { Elysia } from "elysia";
import { confirmComplete } from "./confirm-complete";
import { createTask } from "./create-task";
import { getTask } from "./get-task";
import { listMemberTasks } from "./list-member-tasks";
import { listTasks } from "./list-tasks";
import { reportComplete } from "./report-complete";
import { updateTask } from "./update-task";

/**
 * タスク機能の API(docs/api.md「タスク機能」)。
 * エンドポイントごとにファイルを分けている。
 */
export const taskRoutes = new Elysia({ name: "task-routes" })
  .use(createTask)
  .use(listTasks)
  .use(getTask)
  .use(listMemberTasks)
  .use(updateTask)
  .use(reportComplete)
  .use(confirmComplete);
