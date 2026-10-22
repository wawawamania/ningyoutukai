import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { productMembers } from "../../src/db/schema";
import {
  cleanup,
  createOutsider,
  createTaskType,
  findTask,
  insertTask,
  setupProduct,
} from "../task/helpers";
import { assign } from "./helpers";

type Setup = Awaited<ReturnType<typeof setupProduct>>;
let a: Setup;

beforeAll(async () => {
  a = await setupProduct({ members: 3 });
});
afterAll(async () => {
  await cleanup();
});

const NOT_LEADER = { message: "プロダクトリーダーのみ実行できます" };
const NO_PRODUCT = { message: "プロダクトが見つかりません" };

type Case = {
  who: string;
  state: string;
  expected: number;
  body?: unknown;
};

// タスクの状態: 公開 / 非公開 / 完了済み、担当は members[0]
const states = {
  公開: { isVisible: true },
  非公開: { isVisible: false },
  完了済み: { completedAt: new Date() },
} as const;

describe("権限の表(行列)", () => {
  const cases: Case[] = [];
  for (const state of Object.keys(states)) {
    cases.push({ who: "認証なし", state, expected: 401, body: { message: "ログインが必要です" } });
    cases.push({ who: "所属していない人", state, expected: 404, body: NO_PRODUCT });
    cases.push({ who: "担当者本人(メンバー)", state, expected: 403, body: NOT_LEADER });
    cases.push({ who: "別のメンバー", state, expected: 403, body: NOT_LEADER });
    cases.push({
      who: "リーダー",
      state,
      expected: state === "完了済み" ? 409 : 200,
    });
  }

  for (const c of cases) {
    test(`${c.who} x ${c.state}タスク -> ${c.expected}`, async () => {
      const task = await insertTask(
        a.members[0]!.memberId,
        states[c.state as keyof typeof states]
      );
      const kind = await createTaskType(a.productId);
      const cookie =
        c.who === "認証なし"
          ? undefined
          : c.who === "所属していない人"
            ? (await createOutsider()).cookie
            : c.who === "担当者本人(メンバー)"
              ? a.members[0]!.cookie
              : c.who === "別のメンバー"
                ? a.members[1]!.cookie
                : a.leader.cookie;
      const res = await assign(cookie, a.productId, task.taskId, kind.taskTypeId);
      expect(res.status).toBe(c.expected);
      const json = await res.json();
      if (c.body) expect(json).toEqual(c.body);
      if (c.expected === 409) expect(json).toEqual({ message: "完了済みのタスクは変更できません" });
      const after = (await findTask(task.taskId))!;
      expect(after.taskTypeId).toBe(c.expected === 200 ? kind.taskTypeId : null);
    });
  }

  test("プロダクトから外された(メンバーの行が消えた)元メンバーは 404", async () => {
    const removed = a.members[2]!;
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    await db.delete(productMembers).where(eq(productMembers.productMemberId, removed.memberId));
    const res = await assign(removed.cookie, a.productId, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NO_PRODUCT);
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
  });

  test("プロダクトから外された元リーダー相当(リーダーの行が消えた)は 404 で、操作できない", async () => {
    const solo = await setupProduct({ members: 0 });
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(solo.productId);
    await db.delete(productMembers).where(eq(productMembers.productMemberId, solo.leader.memberId));
    const res = await assign(solo.leader.cookie, solo.productId, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(404);
  });
});

describe("判定の順序(update-task と同じ: 所属 404 -> メンバー 403 -> タスク 404 -> 種類 404 -> 完了 409)", () => {
  test("所属していない人は、存在しないタスク・種類でも 404(プロダクトが見つかりません)", async () => {
    const outsider = await createOutsider();
    const res = await assign(outsider.cookie, a.productId, crypto.randomUUID(), crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NO_PRODUCT);
  });

  test("メンバーは、存在しないタスク・種類でも 403(存在の有無が漏れない)", async () => {
    const res = await assign(a.members[0]!.cookie, a.productId, crypto.randomUUID(), crypto.randomUUID());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(NOT_LEADER);
  });

  test("リーダー: タスクも種類も無いときは、タスクの 404 が先", async () => {
    const res = await assign(a.leader.cookie, a.productId, crypto.randomUUID(), crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
  });

  test("リーダー: 完了済みタスクでも、種類が無ければ種類の 404 が 409 より先", async () => {
    const task = await insertTask(a.members[0]!.memberId, { completedAt: new Date() });
    const res = await assign(a.leader.cookie, a.productId, task.taskId, crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクの種類が見つかりません" });
  });

  test("update-task と同じく、完了済みは 409 で同じ本文", async () => {
    const { request } = await import("../task/helpers");
    const task = await insertTask(a.members[0]!.memberId, { completedAt: new Date() });
    const kind = await createTaskType(a.productId);
    const viaAssign = await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    const viaUpdate = await request("PATCH", `/api/product/${a.productId}/task/${task.taskId}`, {
      cookie: a.leader.cookie,
      body: { taskName: "x" },
    });
    expect(viaAssign.status).toBe(viaUpdate.status);
    expect(await viaAssign.json()).toEqual(await viaUpdate.json());
  });
});
