import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { productMembers, users } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { memberColumns, memberSchema, messageSchema } from "../../lib/member-view";
import { getMembership } from "../../lib/product-access";

// メンバー情報取得 GET /api/product/:productId/member/:memberId
// memberId は product_members.product_member_id(メンバーのタスク取得 API と同じ解釈)
export const getMember = new Elysia({ name: "member-get-member" })
  .use(authGuard)
  .get(
    "/api/product/:productId/member/:memberId",
    async ({ params, user, status }) => {
      const viewer = await getMembership(params.productId, user.userId);
      if (!viewer) return status(404, { message: "プロダクトが見つかりません" });

      const [member] = await db
        .select(memberColumns)
        .from(productMembers)
        .innerJoin(users, eq(productMembers.userId, users.userId))
        .where(
          and(
            eq(productMembers.productId, params.productId),
            eq(productMembers.productMemberId, params.memberId)
          )
        );
      if (!member) return status(404, { message: "メンバーが見つかりません" });

      return status(200, member);
    },
    {
      requireUser: true,
      params: t.Object({
        productId: t.String({ format: "uuid" }),
        memberId: t.String({ format: "uuid" }),
      }),
      response: { 200: memberSchema, 404: messageSchema },
      detail: { summary: "メンバー情報取得" },
    }
  );
