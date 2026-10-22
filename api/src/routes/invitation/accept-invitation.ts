import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { products } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { MessageSchema, respondToInvitation } from "../../lib/invitation";

// 招待承認 POST /api/invitation/:invitationId/accept
// 自分宛ての保留中の招待を承認し、プロダクトのメンバー(member)になる。
// 他人宛て・存在しない招待は 404、応答済みの招待、すでにメンバーの場合は 409。
export const acceptInvitation = new Elysia({ name: "invitation-accept-invitation" })
  .use(authGuard)
  .post(
    "/api/invitation/:invitationId/accept",
    async ({ params, user, status }) => {
      const result = await respondToInvitation(params.invitationId, user, true);
      if (result.kind === "not_found") return status(404, { message: "招待が見つかりません" });
      if (result.kind === "already_responded") {
        return status(409, { message: "この招待にはすでに回答済みです" });
      }
      if (result.kind === "already_member") {
        return status(409, { message: "すでにプロダクトのメンバーです" });
      }

      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.productId, result.invitation.productId));
      return status(200, {
        productId: product.productId,
        productName: product.productName,
        createdAt: product.createdAt.toISOString(),
        role: "member" as const,
      });
    },
    {
      requireUser: true,
      params: t.Object({ invitationId: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({
          productId: t.String(),
          productName: t.String(),
          createdAt: t.String(),
          role: t.Literal("member"),
        }),
        404: MessageSchema,
        409: MessageSchema,
      },
      detail: { summary: "招待承認" },
    }
  );
