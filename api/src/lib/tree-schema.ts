import { t, type Static } from "elysia";

/**
 * ツリー表示 API のレスポンスの形。
 * スキーマを 1 か所で書き、型(`Static`)・レスポンスの検証・Swagger の表示のすべてに使う。
 */

// DB の Date は、JSON になると ISO 文字列になる
const nullableDate = t.Union([t.Date(), t.Null()]);

export const TreeTaskSchema = t.Object({
  taskId: t.String(),
  taskName: t.String(),
  description: t.Union([t.String(), t.Null()]),
  timeLimit: nullableDate,
  reportedAt: nullableDate,
  isVisible: t.Boolean(),
  taskType: t.Union([
    t.Object({ taskTypeId: t.String(), taskTypeName: t.String() }),
    t.Null(),
  ]),
});

export const TreeNodeSchema = t.Object({
  productMemberId: t.String(),
  userId: t.String(),
  userName: t.String(),
  avatarUrl: t.Union([t.String(), t.Null()]),
  role: t.Union([t.Literal("leader"), t.Literal("member")]),
  tasks: t.Array(TreeTaskSchema),
});

export const ProductTreeSchema = t.Object({
  product: t.Object({ productId: t.String(), productName: t.String() }),
  leader: t.Union([TreeNodeSchema, t.Null()]),
  members: t.Array(TreeNodeSchema),
  // 呼び出したユーザー自身の productMemberId(自分のタスクかどうかを、画面が判断するために使う)
  viewerProductMemberId: t.String(),
});

export type TreeTask = Static<typeof TreeTaskSchema>;
export type TreeNode = Static<typeof TreeNodeSchema>;
export type ProductTree = Static<typeof ProductTreeSchema>;
