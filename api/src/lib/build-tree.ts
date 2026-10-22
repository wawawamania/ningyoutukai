// ツリー表示用データの組み立て。DB には触らない純粋関数。
import type { productMembers, products, taskTypes, tasks, users } from "../db/schema";
import type { ProductTree, TreeNode, TreeTask } from "./tree-schema";

// 入力(DB から取ってきた行)の型は、drizzle のテーブルの型から作る
type Member = typeof productMembers.$inferSelect;
type User = typeof users.$inferSelect;
type Task = typeof tasks.$inferSelect;
type TaskType = typeof taskTypes.$inferSelect;
type Product = typeof products.$inferSelect;

export type MemberRow = Pick<Member, "productMemberId" | "userId" | "role"> &
  Pick<User, "userName" | "avatarUrl">;

// タスクの種類は left join なので、種類名は null になりうる
export type TaskRow = Pick<
  Task,
  | "taskId"
  | "taskName"
  | "description"
  | "timeLimit"
  | "reportedAt"
  | "isVisible"
  | "productMemberId"
  | "taskTypeId"
> & { taskTypeName: TaskType["taskTypeName"] | null };

export function buildTree(
  product: Pick<Product, "productId" | "productName">,
  memberRows: MemberRow[],
  taskRows: TaskRow[],
  viewerProductMemberId: string,
): ProductTree {
  // メンバーごとにタスクをまとめる（入力の並び順を保つ）
  const tasksByMember = new Map<string, TreeTask[]>();
  for (const row of taskRows) {
    const task: TreeTask = {
      taskId: row.taskId,
      taskName: row.taskName,
      description: row.description,
      timeLimit: row.timeLimit,
      reportedAt: row.reportedAt,
      isVisible: row.isVisible,
      taskType:
        row.taskTypeId && row.taskTypeName
          ? { taskTypeId: row.taskTypeId, taskTypeName: row.taskTypeName }
          : null,
    };
    const list = tasksByMember.get(row.productMemberId);
    if (list) list.push(task);
    else tasksByMember.set(row.productMemberId, [task]);
  }

  const nodes: TreeNode[] = memberRows.map((m) => ({
    productMemberId: m.productMemberId,
    userId: m.userId,
    userName: m.userName,
    avatarUrl: m.avatarUrl,
    role: m.role,
    tasks: tasksByMember.get(m.productMemberId) ?? [],
  }));

  // リーダーは最上部に1人。想定外に複数いても、2人目以降は members に入れて落とさない
  const leaderIndex = nodes.findIndex((n) => n.role === "leader");
  const leader = leaderIndex >= 0 ? nodes[leaderIndex] : null;
  const members = nodes.filter((_, i) => i !== leaderIndex);

  return { product, leader, members, viewerProductMemberId };
}
