import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { taskTypes } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { getMembership } from "../../lib/product-access";
import { messageSchema } from "../../lib/task-kind";

// タスクの種類を削除 DELETE /api/product/:productId/task_kinds/:kindId
// 使っているタスクは消さない。tasks.task_type_id は onDelete: set null なので、種類だけ外れる。
export const deleteTaskKind = new Elysia({ name: "task-kind-delete" })
  .use(authGuard)
  .delete(
    "/api/product/:productId/task_kinds/:kindId",
    async ({ params, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });
      if (membership.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      const deleted = await db
        .delete(taskTypes)
        .where(
          and(
            eq(taskTypes.taskTypeId, params.kindId),
            eq(taskTypes.productId, params.productId)
          )
        )
        .returning({ taskTypeId: taskTypes.taskTypeId });
      if (deleted.length === 0) {
        return status(404, { message: "タスクの種類が見つかりません" });
      }

      return status(204, undefined);
    },
    {
      requireUser: true,
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        kindId: t.String({ format: "uuid" }),
      }),
      response: { 204: t.Void(), 403: messageSchema(), 404: messageSchema() },
      detail: { summary: "タスクの種類を削除" },
    }
  );
