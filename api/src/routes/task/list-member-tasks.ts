import { and, asc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { getMembership, isMemberOfProduct } from "../../lib/product-access";
import { notCompleted, taskColumns, visibleTo } from "../../lib/task-view";

// 指定したメンバーのタスクを取得 GET /api/product/:productId/member/:memberId/task
export const listMemberTasks = new Elysia({ name: "task-list-member-tasks" })
  .use(authGuard)
  .get(
    "/api/product/:productId/member/:memberId/task",
    async ({ params, query, user, status }) => {
      const viewer = await getMembership(params.productId, user.userId);
      if (!viewer) return status(404, { message: "プロダクトが見つかりません" });

      if (!(await isMemberOfProduct(params.productId, params.memberId)))
        return status(404, { message: "メンバーが見つかりません" });

      return await db
        .select(taskColumns)
        .from(tasks)
        .where(
          and(
            eq(tasks.productMemberId, params.memberId),
            visibleTo(viewer),
            query.includeCompleted ? undefined : notCompleted()
          )
        )
        // 期限の昇順(期限なしは最後)、同じ期限なら taskId の昇順
        .orderBy(sql`${tasks.timeLimit} asc nulls last`, asc(tasks.taskId));
    },
    {
      requireUser: true,
      query: t.Object({ includeCompleted: t.Optional(t.BooleanString()) }),
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        memberId: t.String({ format: "uuid" }),
      }),
      detail: { summary: "指定したメンバーのタスクを取得" },
    }
  );
