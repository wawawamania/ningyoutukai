import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { taskTypes } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { getMembership } from "../../lib/product-access";
import {
  isUniqueViolation,
  messageSchema,
  normalizeTaskKindName,
  taskKindColumns,
  taskKindNameSchema,
  taskKindSchema,
} from "../../lib/task-kind";

// タスクの種類を編集 PATCH /api/product/:productId/task_kinds/:kindId
export const updateTaskKind = new Elysia({ name: "task-kind-update" })
  .use(authGuard)
  .patch(
    "/api/product/:productId/task_kinds/:kindId",
    async ({ params, body, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });
      if (membership.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      const taskTypeName = normalizeTaskKindName(body.taskTypeName);
      if (!taskTypeName) return status(400, { message: "種類の名前を入力してください" });

      try {
        // URL のプロダクトに属する種類だけを更新する(自分自身と同じ名前への変更は成功)
        const [updated] = await db
          .update(taskTypes)
          .set({ taskTypeName })
          .where(
            and(
              eq(taskTypes.taskTypeId, params.kindId),
              eq(taskTypes.productId, params.productId)
            )
          )
          .returning(taskKindColumns);
        if (!updated) return status(404, { message: "タスクの種類が見つかりません" });
        return updated;
      } catch (e) {
        if (isUniqueViolation(e)) {
          return status(409, { message: "同じ名前のタスクの種類がすでにあります" });
        }
        throw e;
      }
    },
    {
      requireUser: true,
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        kindId: t.String({ format: "uuid" }),
      }),
      body: t.Object({ taskTypeName: taskKindNameSchema() }),
      response: {
        200: taskKindSchema(),
        400: messageSchema(),
        403: messageSchema(),
        404: messageSchema(),
        409: messageSchema(),
      },
      detail: { summary: "タスクの種類を編集" },
    }
  );
