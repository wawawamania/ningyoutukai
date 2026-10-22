import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { productMembers, users } from "../db/schema";

export type Membership = {
  productMemberId: string;
  role: "leader" | "member";
};

/**
 * ユーザーがプロダクトに所属していれば、そのメンバー情報を返す。所属していなければ undefined。
 * 所属していないプロダクトは存在を漏らさないよう、呼び出し側で 404 にする。
 */
export async function getMembership(
  productId: string,
  userId: string
): Promise<Membership | undefined> {
  const [row] = await db
    .select({
      productMemberId: productMembers.productMemberId,
      role: productMembers.role,
    })
    .from(productMembers)
    .where(
      and(
        eq(productMembers.productId, productId),
        eq(productMembers.userId, userId)
      )
    );
  return row;
}

/** メンバーの連絡先(通知メールの宛先)。メンバーが存在しなければ undefined */
export async function getMemberContact(memberId: string) {
  const [row] = await db
    .select({ email: users.email, userName: users.userName })
    .from(productMembers)
    .innerJoin(users, eq(productMembers.userId, users.userId))
    .where(eq(productMembers.productMemberId, memberId));
  return row;
}

/** プロダクトのリーダーの連絡先の一覧(完了報告の通知先) */
export async function getLeaderContacts(productId: string) {
  return await db
    .select({ email: users.email, userName: users.userName })
    .from(productMembers)
    .innerJoin(users, eq(productMembers.userId, users.userId))
    .where(
      and(
        eq(productMembers.productId, productId),
        eq(productMembers.role, "leader")
      )
    );
}

/** 指定した memberId が、そのプロダクトのメンバーなら true */
export async function isMemberOfProduct(productId: string, memberId: string) {
  const [row] = await db
    .select({ productMemberId: productMembers.productMemberId })
    .from(productMembers)
    .where(
      and(
        eq(productMembers.productId, productId),
        eq(productMembers.productMemberId, memberId)
      )
    );
  return Boolean(row);
}
