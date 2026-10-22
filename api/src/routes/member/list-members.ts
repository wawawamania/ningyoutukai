import { asc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { productMembers, users } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { memberColumns, memberSchema, messageSchema } from "../../lib/member-view";
import { getMembership } from "../../lib/product-access";

// メンバー一覧取得 GET /api/product/:productId/member
export const listMembers = new Elysia({ name: "member-list-members" })
  .use(authGuard)
  .get(
    "/api/product/:productId/member",
    async ({ params, user, status }) => {
      const viewer = await getMembership(params.productId, user.userId);
      if (!viewer) return status(404, { message: "プロダクトが見つかりません" });

      const rows = await db
        .select(memberColumns)
        .from(productMembers)
        .innerJoin(users, eq(productMembers.userId, users.userId))
        .where(eq(productMembers.productId, params.productId))
        // リーダーが先、次に名前順(同名なら productMemberId で安定させる)
        .orderBy(
          sql`case when ${productMembers.role} = 'leader' then 0 else 1 end`,
          asc(users.userName),
          asc(productMembers.productMemberId)
        );
      return status(200, rows);
    },
    {
      requireUser: true,
      params: t.Object({ productId: t.String({ format: "uuid" }) }),
      response: { 200: t.Array(memberSchema), 404: messageSchema },
      detail: { summary: "メンバー一覧取得" },
    }
  );
