import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { productMembers, tasks } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { messageSchema } from "../../lib/member-view";
import { getMembership } from "../../lib/product-access";

// メンバー削除 DELETE /api/product/:productId/member/:memberId
// 要件: メンバーを削除すると、そのメンバーに紐づくタスク(担当タスク)も一緒に削除する。
export const deleteMember = new Elysia({ name: "member-delete-member" })
  .use(authGuard)
  .delete(
    "/api/product/:productId/member/:memberId",
    async ({ params, user, status }) => {
      const viewer = await getMembership(params.productId, user.userId);
      if (!viewer) return status(404, { message: "プロダクトが見つかりません" });
      if (viewer.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      const [target] = await db
        .select({
          productMemberId: productMembers.productMemberId,
          role: productMembers.role,
        })
        .from(productMembers)
        .where(
          and(
            eq(productMembers.productId, params.productId),
            eq(productMembers.productMemberId, params.memberId)
          )
        );
      if (!target) return status(404, { message: "メンバーが見つかりません" });
      if (target.role === "leader") {
        return status(409, { message: "リーダーは削除できません" });
      }

      // タスクを先に消してからメンバーを消す(スキーマの cascade に頼らず明示する)
      // 同時削除では片方の delete が 0 件になるので、その場合は 404 を返す
      // (タスクの削除は行ロックで直列化され、後続側は 0 件になるだけでエラーにならない)
      const deleted = await db.transaction(async (tx) => {
        await tx.delete(tasks).where(eq(tasks.productMemberId, target.productMemberId));
        return tx
          .delete(productMembers)
          .where(eq(productMembers.productMemberId, target.productMemberId))
          .returning({ productMemberId: productMembers.productMemberId });
      });
      if (deleted.length === 0) {
        return status(404, { message: "メンバーが見つかりません" });
      }

      return status(204, undefined);
    },
    {
      requireUser: true,
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        memberId: t.String({ format: "uuid" }),
      }),
      response: {
        204: t.Void(),
        403: messageSchema,
        404: messageSchema,
        409: messageSchema,
      },
      detail: { summary: "メンバーを削除" },
    }
  );
