import { Elysia, t } from "elysia";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { products, productMembers, tasks, taskTypes, users } from "../db/schema";
import { authGuard } from "../lib/auth-guard";
import { buildTree } from "../lib/build-tree";
import { ProductTreeSchema } from "../lib/tree-schema";

export const productTreeRoutes = new Elysia({ prefix: "/api/product" })
  .use(authGuard)
  .get(
    "/:productId/tree",
    async ({ params, user, status }) => {
      const { productId } = params;

      // 1. 呼び出したユーザーがこのプロダクトのメンバーか確認する。
      //    メンバーでない・存在しない場合はどちらも404（存在を漏らさない）
      const [me] = await db
        .select({
          productMemberId: productMembers.productMemberId,
          role: productMembers.role,
        })
        .from(productMembers)
        .where(
          and(
            eq(productMembers.productId, productId),
            eq(productMembers.userId, user.userId),
          ),
        )
        .limit(1);

      if (!me) return status(404, { message: "プロダクトが見つかりません" });

      // 2. プロダクト情報
      const [product] = await db
        .select({
          productId: products.productId,
          productName: products.productName,
        })
        .from(products)
        .where(eq(products.productId, productId))
        .limit(1);

      if (!product) return status(404, { message: "プロダクトが見つかりません" });

      // 3. メンバー一覧（ユーザー情報つき）。並び順は名前順で固定する
      const memberRows = await db
        .select({
          productMemberId: productMembers.productMemberId,
          userId: productMembers.userId,
          role: productMembers.role,
          userName: users.userName,
          avatarUrl: users.avatarUrl,
        })
        .from(productMembers)
        .innerJoin(users, eq(users.userId, productMembers.userId))
        .where(eq(productMembers.productId, productId))
        .orderBy(asc(users.userName), asc(productMembers.productMemberId));

      // 4. タスク一覧
      //    - 完了済み（completed_at あり）は表示しない（要件4-4）
      //    - 非表示タスクは、リーダーと担当者本人にだけ見せる（要件4-2）
      const viewerIsLeader = me.role === "leader";
      const visibility = viewerIsLeader
        ? undefined
        : or(
            eq(tasks.isVisible, true),
            eq(tasks.productMemberId, me.productMemberId),
          );

      const taskRows = await db
        .select({
          taskId: tasks.taskId,
          taskName: tasks.taskName,
          description: tasks.description,
          timeLimit: tasks.timeLimit,
          reportedAt: tasks.reportedAt,
          isVisible: tasks.isVisible,
          productMemberId: tasks.productMemberId,
          taskTypeId: taskTypes.taskTypeId,
          taskTypeName: taskTypes.taskTypeName,
        })
        .from(tasks)
        .leftJoin(taskTypes, eq(taskTypes.taskTypeId, tasks.taskTypeId))
        .where(
          and(
            inArray(
              tasks.productMemberId,
              memberRows.map((m) => m.productMemberId),
            ),
            isNull(tasks.completedAt),
            visibility,
          ),
        )
        .orderBy(asc(tasks.timeLimit), asc(tasks.taskId));

      // 5. ツリーに組み立てて返す
      return buildTree(product, memberRows, taskRows, me.productMemberId);
    },
    {
        requireUser: true,
        params: t.Object({ productId: t.String({ format: "uuid" }) }),
        response: {
          200: ProductTreeSchema,
          404: t.Object({ message: t.String() }),
        },
        detail: { summary: "プロダクト構造取得（ツリー表示）" },
    },
  );