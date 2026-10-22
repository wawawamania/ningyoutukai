import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { productInvitations, productMembers, products, users } from "../../db/schema";
import { authGuard } from "../../lib/auth-guard";
import { addressedTo } from "../../lib/invitation";

// 招待一覧取得 GET /api/invitation
// ログイン中のユーザー宛ての「保留中」の招待だけを、新しい順に返す。
// 招待した人は記録していないので、招待元プロダクトのリーダーの名前を返す。
export const listInvitations = new Elysia({ name: "invitation-list-invitations" })
  .use(authGuard)
  .get(
    "/api/invitation",
    async ({ user }) => {
      const rows = await db
        .select({
          invitationId: productInvitations.invitationId,
          productId: productInvitations.productId,
          productName: products.productName,
          createdAt: productInvitations.createdAt,
        })
        .from(productInvitations)
        .innerJoin(products, eq(productInvitations.productId, products.productId))
        .where(and(eq(productInvitations.status, "pending"), addressedTo(user)))
        .orderBy(desc(productInvitations.createdAt), asc(productInvitations.invitationId));
      if (rows.length === 0) return [];

      const leaders = await db
        .select({ productId: productMembers.productId, userName: users.userName })
        .from(productMembers)
        .innerJoin(users, eq(productMembers.userId, users.userId))
        .where(
          and(
            inArray(productMembers.productId, [...new Set(rows.map((r) => r.productId))]),
            eq(productMembers.role, "leader")
          )
        )
        .orderBy(asc(users.userName));

      return rows.map((r) => ({
        invitationId: r.invitationId,
        productId: r.productId,
        productName: r.productName,
        leaderNames: leaders.filter((l) => l.productId === r.productId).map((l) => l.userName),
        createdAt: r.createdAt.toISOString(),
      }));
    },
    {
      requireUser: true,
      response: {
        200: t.Array(
          t.Object({
            invitationId: t.String(),
            productId: t.String(),
            productName: t.String(),
            leaderNames: t.Array(t.String()),
            createdAt: t.String(),
          })
        ),
      },
      detail: { summary: "招待一覧取得" },
    }
  );
