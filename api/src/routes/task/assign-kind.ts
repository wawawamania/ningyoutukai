import { and, eq, isNull } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { productMembers, taskTypes, tasks } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { getMembership } from "../../lib/product-access";
import { taskColumns } from "../../lib/task-view";

const COMPLETED_ERROR = "完了済みのタスクは変更できません";

// タスクに種類を割り当てる PATCH /api/product/:productId/task/:taskId/task_kinds/:kindId(リーダーのみ)
export const assignKindRoutes = new Elysia({ name: "task-assign-kind" })
  .use(authGuard)
  .patch(
    "/api/product/:productId/task/:taskId/task_kinds/:kindId",
    async ({ params, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });
      if (membership.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      // タスクが URL のプロダクトに属しているか(リーダーは非公開タスクも見られる)
      const [task] = await db
        .select(taskColumns)
        .from(tasks)
        .innerJoin(
          productMembers,
          eq(tasks.productMemberId, productMembers.productMemberId)
        )
        .where(
          and(
            eq(tasks.taskId, params.taskId),
            eq(productMembers.productId, params.productId)
          )
        );
      if (!task) return status(404, { message: "タスクが見つかりません" });

      // 種類が同じプロダクトのものか(別プロダクトの種類は存在を漏らさず 404)
      const [kind] = await db
        .select({ taskTypeId: taskTypes.taskTypeId })
        .from(taskTypes)
        .where(
          and(
            eq(taskTypes.taskTypeId, params.kindId),
            eq(taskTypes.productId, params.productId)
          )
        );
      if (!kind) return status(404, { message: "タスクの種類が見つかりません" });

      if (task.completedAt) return status(409, { message: COMPLETED_ERROR });

      const [updated] = await db
        .update(tasks)
        .set({ taskTypeId: kind.taskTypeId })
        .where(and(eq(tasks.taskId, params.taskId), isNull(tasks.completedAt)))
        .returning(taskColumns);
      // 確認から更新までの間に完了確定された場合
      if (!updated) return status(409, { message: COMPLETED_ERROR });
      return updated;
    },
    {
      requireUser: true,
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        taskId: t.String({ format: "uuid" }),
        kindId: t.String({ format: "uuid" }),
      }),
      detail: { summary: "タスクに種類を割り当てる" },
    }
  );
