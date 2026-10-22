import { and, eq, isNull } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { productMembers, tasks } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { getMembership } from "../../lib/product-access";
import {
  TIME_LIMIT_ERROR,
  descriptionSchema,
  parseTimeLimit,
  taskNameSchema,
  timeLimitSchema,
} from "../../lib/task-input";
import { taskStillExists } from "../../lib/task-race";
import { taskColumns } from "../../lib/task-view";

const COMPLETED_ERROR = "完了済みのタスクは変更できません";

// タスク情報変更 PATCH /api/product/:productId/task/:taskId(リーダーのみ)
export const updateTask = new Elysia({ name: "task-update-task" })
  .use(authGuard)
  .patch(
    "/api/product/:productId/task/:taskId",
    async ({ params, body, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });
      if (membership.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      // タスクが URL のプロダクトに属しているか
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

      // 完了済みのタスクは変更できない(body の検証より先に判定する)
      if (task.completedAt) return status(409, { message: COMPLETED_ERROR });

      // 変更する項目だけを集める(body に含まれない項目は変更しない)
      const changes: Partial<typeof tasks.$inferInsert> = {};
      if (body.taskName !== undefined) {
        const taskName = body.taskName.trim();
        if (!taskName) return status(400, { message: "タスク名を入力してください" });
        changes.taskName = taskName;
      }
      if (body.description !== undefined) changes.description = body.description;
      if (body.timeLimit !== undefined) {
        if (body.timeLimit === null) {
          changes.timeLimit = null;
        } else {
          const parsed = parseTimeLimit(body.timeLimit);
          if (!parsed) return status(400, { message: TIME_LIMIT_ERROR });
          changes.timeLimit = parsed;
        }
      }
      if (body.isVisible !== undefined) changes.isVisible = body.isVisible;

      if (Object.keys(changes).length === 0) {
        return status(400, { message: "変更する項目を指定してください" });
      }

      const [updated] = await db
        .update(tasks)
        .set(changes)
        .where(and(eq(tasks.taskId, params.taskId), isNull(tasks.completedAt)))
        .returning(taskColumns);
      if (!updated) {
        // 確認から更新までの間に削除された場合
        if (!(await taskStillExists(params.taskId))) {
          return status(404, { message: "タスクが見つかりません" });
        }
        // 確認から更新までの間に完了確定された場合
        return status(409, { message: COMPLETED_ERROR });
      }
      return updated;
    },
    {
      requireUser: true,
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        taskId: t.String({ format: "uuid" }),
      }),
      body: t.Object({
        taskName: t.Optional(taskNameSchema()),
        description: t.Optional(t.Union([descriptionSchema(), t.Null()])),
        timeLimit: t.Optional(t.Union([timeLimitSchema(), t.Null()])),
        isVisible: t.Optional(t.Boolean()),
      }),
      detail: { summary: "タスク情報変更" },
    }
  );
