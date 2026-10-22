import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
import { products } from "../db/schema";
import { authGuard } from "../lib/auth-guard";
import { getMembership } from "../lib/product-access";
import { NO_NUL } from "../lib/validation";

const messageSchema =t.Object({ message: t.String() });

const productSchema = t.Object({
  productId: t.String(),
  productName: t.String(),
  createdAt: t.Date(),
  role: t.Union([t.Literal("leader"), t.Literal("member")]),
});

export const productManageRoutes = new Elysia({ name: "product-manage" })
  .use(authGuard)
  // プロダクト情報変更(リーダーのみ): 所属していないプロダクトは存在を漏らさないよう 404
  .patch(
    "/api/product/:productId",
    async ({ params, body, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });
      if (membership.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      const productName = body.productName.trim();
      if (!productName) return status(400, { message: "プロダクト名を入力してください" });

      const [updated] = await db
        .update(products)
        .set({ productName })
        .where(eq(products.productId, params.productId))
        .returning();
      if (!updated) return status(404, { message: "プロダクトが見つかりません" });

      return status(200, { ...updated, role: membership.role });
    },
    {
      requireUser: true,
      params: t.Object({ productId: t.String({ format: "uuid" }) }),
      // NUL 文字は PostgreSQL が拒否して 500 になるため、pattern で弾いて 422 にする
      body: t.Object({ productName: t.String({ maxLength: 100, pattern: NO_NUL }) }),
      response: { 200: productSchema, 400: messageSchema, 403: messageSchema, 404: messageSchema },
      detail: { summary: "プロダクト情報変更(リーダー)" },
    }
  )
  // プロダクト削除(リーダーのみ): メンバー・招待・タスク種類・タスクは外部キーの cascade で一緒に消える
  .delete(
    "/api/product/:productId",
    async ({ params, user, status }) => {
      const membership = await getMembership(params.productId, user.userId);
      if (!membership) return status(404, { message: "プロダクトが見つかりません" });
      if (membership.role !== "leader") {
        return status(403, { message: "プロダクトリーダーのみ実行できます" });
      }

      const deleted = await db
        .delete(products)
        .where(eq(products.productId, params.productId))
        .returning({ productId: products.productId });
      if (deleted.length === 0) return status(404, { message: "プロダクトが見つかりません" });

      return status(204, undefined);
    },
    {
      requireUser: true,
      params: t.Object({ productId: t.String({ format: "uuid" }) }),
      response: { 204: t.Undefined(), 403: messageSchema, 404: messageSchema },
      detail: { summary: "プロダクト削除(リーダー)" },
    }
  );
