import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { productMembers, tasks } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { getMembership } from "../../lib/product-access";
import { canSee, taskColumns } from "../../lib/task-view";

// 指定したタスクを取得 GET /api/product/:productId/task/:taskId
export const getTask = new Elysia({ name: "task-get-task" })
  .use(authGuard)
  .get(
    "/api/product/:productId/task/:taskId",
    async ({ params, user, status }) => {
      const viewer = await getMembership(params.productId, user.userId);
      if (!viewer) return status(404, { message: "プロダクトが見つかりません" });

      // タスクは担当メンバーを経由してプロダクトに属する。URL のプロダクトと一致するものだけ探す
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
      // 見えないタスクは存在を漏らさないよう、存在しない場合と同じ 404 にする
      if (!task || !canSee(task, viewer))
        return status(404, { message: "タスクが見つかりません" });

      return task;
    },
    {
      requireUser: true,
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        taskId: t.String({ format: "uuid" }),
      }),
      detail: { summary: "指定したタスクを取得" },
    }
  );
