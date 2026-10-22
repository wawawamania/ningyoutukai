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

// タスクの種類を追加 POST /api/product/:productId/task_kinds
export const createTaskKind = new Elysia({ name: "task-kind-create" })
  .use(authGuard)
  .post(
    "/api/product/:productId/task_kinds",
    async ({ params, body, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });
      if (membership.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      const taskTypeName = normalizeTaskKindName(body.taskTypeName);
      if (!taskTypeName) return status(400, { message: "種類の名前を入力してください" });

      try {
        const [created] = await db
          .insert(taskTypes)
          .values({ productId: params.productId, taskTypeName })
          .returning(taskKindColumns);
        return status(201, created);
      } catch (e) {
        // unique(product_id, task_type_name) 違反。同時リクエストでも 409 に収束させる
        if (isUniqueViolation(e)) {
          return status(409, { message: "同じ名前のタスクの種類がすでにあります" });
        }
        throw e;
      }
    },
    {
      requireUser: true,
      params: t.Object({ productId: t.String({ format: "uuid" }) }),
      body: t.Object({ taskTypeName: taskKindNameSchema() }),
      response: {
        201: taskKindSchema(),
        400: messageSchema(),
        403: messageSchema(),
        404: messageSchema(),
        409: messageSchema(),
      },
      detail: { summary: "タスクの種類を追加" },
    }
  );
