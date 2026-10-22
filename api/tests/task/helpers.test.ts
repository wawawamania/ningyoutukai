import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { productMembers } from "../../src/db/schema";
import {
  cleanup,
  countTasks,
  createOutsider,
  createTaskType,
  insertTask,
  setupProduct,
} from "./helpers";

afterAll(cleanup);

describe("タスク API のテストヘルパー", () => {
  test("リーダー 1 人とメンバーのいるプロダクトが作られる", async () => {
    const { productId, leader, members } = await setupProduct({ members: 2 });
    expect(members).toHaveLength(2);

    const rows = await db
      .select()
      .from(productMembers)
      .where(eq(productMembers.productId, productId));
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.role === "leader")).toHaveLength(1);
    expect(leader.role).toBe("leader");
    expect(members.every((m) => m.role === "member")).toBe(true);
  });

  test("タスクと種類を DB に直接作れる", async () => {
    const { productId, members } = await setupProduct({ members: 1 });
    const type = await createTaskType(productId);
    const task = await insertTask(members[0]!.memberId, { taskTypeId: type.taskTypeId });
    expect(task.taskTypeId).toBe(type.taskTypeId);
    expect(await countTasks(productId)).toBe(1);
  });

  test("どのプロダクトにも所属しないユーザーを作れる", async () => {
    const outsider = await createOutsider();
    expect(outsider.cookie).toContain("=");
  });
});
