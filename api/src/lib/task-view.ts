import { eq, isNull, or, type SQL } from "drizzle-orm";
import { tasks } from "../db/schema";
import type { Membership } from "./product-access";

/** タスク API が返すタスクの形(全エンドポイントで共通) */
export const taskColumns = {
  taskId: tasks.taskId,
  taskName: tasks.taskName,
  description: tasks.description,
  timeLimit: tasks.timeLimit,
  reportedAt: tasks.reportedAt,
  completedAt: tasks.completedAt,
  taskTypeId: tasks.taskTypeId,
  productMemberId: tasks.productMemberId,
  isVisible: tasks.isVisible,
};

/**
 * タスクの可視性(要件 4-2)
 * - リーダーは、非表示のタスクも含めてすべて見られる
 * - メンバーは、公開されているタスクと、自分が担当のタスクを見られる(非表示でも担当者本人には見える)
 *
 * 返した条件を where に `and` で足して使う。リーダーのときは条件なし(undefined)。
 */
export function visibleTo(viewer: Membership): SQL | undefined {
  if (viewer.role === "leader") return undefined;
  return or(
    eq(tasks.isVisible, true),
    eq(tasks.productMemberId, viewer.productMemberId)
  );
}

/** すでに取得したタスク 1 件が、閲覧者に見えるかどうか(`visibleTo` と同じルール) */
export function canSee(
  task: { isVisible: boolean; productMemberId: string },
  viewer: Membership
) {
  return (
    viewer.role === "leader" ||
    task.isVisible ||
    task.productMemberId === viewer.productMemberId
  );
}

/** 完了したタスクは一覧に出さない(要件 4-4。データは消さず、表示しないだけ) */
export const notCompleted = (): SQL => isNull(tasks.completedAt);
