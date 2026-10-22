import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { taskTypes } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { getMembership } from "../../lib/product-access";
import { messageSchema, taskKindColumns, taskKindSchema } from "../../lib/task-kind";

// タスクの種類一覧を取得 GET /api/product/:productId/task_kinds(名前順)
export const listTaskKinds = new Elysia({ name: "task-kind-list" })
  .use(authGuard)
  .get(
    "/api/product/:productId/task_kinds",
    async ({ params, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });

      return await db
        .select(taskKindColumns)
        .from(taskTypes)
        .where(eq(taskTypes.productId, params.productId))
        .orderBy(asc(taskTypes.taskTypeName), asc(taskTypes.taskTypeId));
    },
    {
      requireUser: true,
      params: t.Object({ productId: t.String({ format: "uuid" }) }),
      response: { 200: t.Array(taskKindSchema()), 404: messageSchema() },
      detail: { summary: "タスクの種類一覧を取得" },
    }
  );
