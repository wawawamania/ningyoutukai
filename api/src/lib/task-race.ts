import { eq } from "drizzle-orm";
import { db } from "../db";
import { tasks } from "../db/schema";

/**
 * 条件付き update が 0 件だったときの「タスクがまだ存在するか」の再確認。
 * 取得から更新までの間に削除されていた場合は存在しない(404 を返す)。
 */
export async function taskStillExists(taskId: string) {
  const [row] = await db
    .select({ taskId: tasks.taskId })
    .from(tasks)
    .where(eq(tasks.taskId, taskId));
  return Boolean(row);
}
