import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { productMembers, tasks } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { getMembership } from "../../lib/product-access";

// タスク削除 DELETE /api/product/:productId/task/:taskId
export const deleteTaskRoutes = new Elysia({ name: "task-delete" })
  .use(authGuard)
  .delete(
    "/api/product/:productId/task/:taskId",
    async ({ params, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });
      if (membership.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      // URL のプロダクトに属するタスクだけを対象にする(別プロダクトのタスクは存在しない扱い)
      const [task] = await db
        .select({ taskId: tasks.taskId })
        .from(tasks)
        .innerJoin(productMembers, eq(tasks.productMemberId, productMembers.productMemberId))
        .where(and(eq(tasks.taskId, params.taskId), eq(productMembers.productId, params.productId)));
      if (!task) return status(404, { message: "タスクが見つかりません" });

      // 同時に削除されて既に無い場合も 404 にする
      const deleted = await db
        .delete(tasks)
        .where(eq(tasks.taskId, task.taskId))
        .returning({ taskId: tasks.taskId });
      if (deleted.length === 0) return status(404, { message: "タスクが見つかりません" });

      return status(204, undefined);
    },
    {
      requireUser: true,
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        taskId: t.String({ format: "uuid" }),
      }),
      response: {
        204: t.Undefined(),
        403: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
      },
      detail: { summary: "タスク削除(リーダー)" },
    }
  );
