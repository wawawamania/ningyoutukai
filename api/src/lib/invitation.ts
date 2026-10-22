import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { t } from "elysia";
import { db } from "../db";
import { productInvitations, productMembers } from "../db/schema";

/** 招待 API が返す招待の形(日時は ISO 文字列) */
export const InvitationSchema = t.Object({
  invitationId: t.String(),
  productId: t.String(),
  inviteeIdentifier: t.String(),
  inviteeType: t.Union([t.Literal("github"), t.Literal("gmail")]),
  status: t.Union([t.Literal("pending"), t.Literal("accepted"), t.Literal("declined")]),
  respondedAt: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

export const MessageSchema = t.Object({ message: t.String() });

type InvitationRow = typeof productInvitations.$inferSelect;

export function toInvitationView(row: InvitationRow) {
  return {
    invitationId: row.invitationId,
    productId: row.productId,
    inviteeIdentifier: row.inviteeIdentifier,
    inviteeType: row.inviteeType,
    status: row.status,
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type Invitee = { userId: string; email: string; githubId: string | null };

/**
 * 「自分宛ての招待」の条件。
 * - 招待時にすでに登録済みだった人: user_id が自分
 * - 未登録のまま招待された人: user_id が空で、招待先(GitHub の username / メール)が自分のものと一致
 *   (大文字小文字は区別しない)
 */
export function addressedTo(me: Invitee): SQL {
  const byIdentifier: SQL[] = [
    and(
      eq(productInvitations.inviteeType, "gmail"),
      sql`lower(${productInvitations.inviteeIdentifier}) = ${me.email.toLowerCase()}`
    )!,
  ];
  if (me.githubId) {
    byIdentifier.push(
      and(
        eq(productInvitations.inviteeType, "github"),
        sql`lower(${productInvitations.inviteeIdentifier}) = ${me.githubId.toLowerCase()}`
      )!
    );
  }
  return or(
    eq(productInvitations.userId, me.userId),
    and(isNull(productInvitations.userId), or(...byIdentifier))
  )!;
}

/** 招待の応答(承認・拒否)の結果 */
export type RespondResult =
  | { kind: "ok"; invitation: InvitationRow }
  | { kind: "not_found" }
  | { kind: "already_responded" }
  | { kind: "already_member" };

/**
 * 保留中の招待に応答する。承認なら、同じトランザクションでメンバーに追加する。
 * 状態の更新は `status = pending` の条件つきなので、同時に 2 回呼ばれても片方だけが成功する。
 */
export async function respondToInvitation(
  invitationId: string,
  me: Invitee,
  accept: boolean
): Promise<RespondResult> {
  return await db.transaction(async (tx): Promise<RespondResult> => {
    const [mine] = await tx
      .select()
      .from(productInvitations)
      .where(and(eq(productInvitations.invitationId, invitationId), addressedTo(me)));
    if (!mine) return { kind: "not_found" };
    if (mine.status !== "pending") return { kind: "already_responded" };

    const [updated] = await tx
      .update(productInvitations)
      .set({
        status: accept ? "accepted" : "declined",
        respondedAt: new Date(),
        userId: me.userId,
      })
      .where(
        and(
          eq(productInvitations.invitationId, invitationId),
          eq(productInvitations.status, "pending")
        )
      )
      .returning();
    if (!updated) return { kind: "already_responded" };

    if (accept) {
      // すでにメンバーなら二重に追加しない(招待は承認済みとして片づけ、呼び出し側が 409 を返す)
      const inserted = await tx
        .insert(productMembers)
        .values({ productId: mine.productId, userId: me.userId, role: "member" })
        .onConflictDoNothing({ target: [productMembers.productId, productMembers.userId] })
        .returning({ productMemberId: productMembers.productMemberId });
      if (inserted.length === 0) return { kind: "already_member" };
    }
    return { kind: "ok", invitation: updated };
  });
}
