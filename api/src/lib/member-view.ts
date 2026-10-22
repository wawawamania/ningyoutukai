import { t } from "elysia";
import { productMembers, users } from "../db/schema";

/**
 * メンバーの公開用の項目。メールアドレスなどの連絡先は含めない(個人情報のため)。
 */
export const memberColumns = {
  productMemberId: productMembers.productMemberId,
  userId: users.userId,
  userName: users.userName,
  avatarUrl: users.avatarUrl,
  role: productMembers.role,
};

export const memberSchema = t.Object({
  productMemberId: t.String(),
  userId: t.String(),
  userName: t.String(),
  avatarUrl: t.Nullable(t.String()),
  role: t.Union([t.Literal("leader"), t.Literal("member")]),
});

export const messageSchema = t.Object({ message: t.String() });
