import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
import { productMembers, products } from "../db/schema";
import { authGuard } from "../lib/auth-guard";
import { NO_NUL } from "../lib/validation";

const productColumns = {
  productId: products.productId,
  productName: products.productName,
  createdAt: products.createdAt,
  role: productMembers.role,
};

export const productRoutes = new Elysia({ prefix: "/api/product" })
  .use(authGuard)
  // プロダクト作成: 作成者は自動でプロダクトリーダーになる
  .post(
    "/",
    async ({ body, user, status }) => {
      const productName = body.productName.trim();
      if (!productName) return status(400, { message: "プロダクト名を入力してください" });

      const created = await db.transaction(async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({ productName })
          .returning();
        await tx.insert(productMembers).values({
          productId: product.productId,
          userId: user.userId,
          role: "leader",
        });
        return product;
      });

      return status(201, { ...created, role: "leader" as const });
    },
    {
      requireUser: true,
      body: t.Object({ productName: t.String({ maxLength: 100, pattern: NO_NUL }) }),
      detail: { summary: "プロダクト作成" },
    }
  )
  // プロダクト一覧: ログイン中のユーザーが所属するもの
  .get(
    "/",
    ({ user }) =>
      db
        .select(productColumns)
        .from(productMembers)
        .innerJoin(products, eq(productMembers.productId, products.productId))
        .where(eq(productMembers.userId, user.userId)),
    { requireUser: true, detail: { summary: "プロダクト一覧取得" } }
  )
  // プロダクト取得: 所属していないプロダクトは存在を漏らさないよう 404
  .get(
    "/:productId",
    async ({ params, user, status }) => {
      const [row] = await db
        .select(productColumns)
        .from(productMembers)
        .innerJoin(products, eq(productMembers.productId, products.productId))
        .where(
          and(
            eq(productMembers.productId, params.productId),
            eq(productMembers.userId, user.userId)
          )
        );
      return row ?? status(404, { message: "プロダクトが見つかりません" });
    },
    {
      requireUser: true,
      params: t.Object({ productId: t.String({ format: "uuid" }) }),
      detail: { summary: "指定したプロダクトを取得" },
    }
  );
