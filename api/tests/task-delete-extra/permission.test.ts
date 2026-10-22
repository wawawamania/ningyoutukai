import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, createOutsider, findTask, insertTask, setupProduct } from "../task/helpers";
import { call, findMember, promoteToLeader, removeMember, taskPath } from "./helpers";

afterAll(cleanup);

// タスクの状態(公開・非公開 × 未報告・報告済み・完了済み)
const states = {
  公開: {},
  非公開: { isVisible: false },
  報告済み: { reportedAt: new Date() },
  完了済み: { reportedAt: new Date(), completedAt: new Date() },
  "非公開かつ完了済み": { isVisible: false, reportedAt: new Date(), completedAt: new Date() },
} as const;

describe("DELETE タスク: 権限の表(ロール × タスクの状態)", () => {
  for (const [label, values] of Object.entries(states)) {
    describe(`${label}のタスク`, () => {
      test("リーダーは 204", async () => {
        const { productId, leader, members } = await setupProduct();
        const task = await insertTask(members[0]!.memberId, values);
        const res = await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });
        expect(res.status).toBe(204);
        expect(await res.text()).toBe("");
        expect(await findTask(task.taskId)).toBeUndefined();
      });

      test("担当者本人のメンバーは 403", async () => {
        const { productId, members } = await setupProduct();
        const task = await insertTask(members[0]!.memberId, values);
        const res = await call("DELETE", taskPath(productId, task.taskId), {
          cookie: members[0]!.cookie,
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
        expect(await findTask(task.taskId)).toBeDefined();
      });

      test("別のメンバーは 403", async () => {
        const { productId, members } = await setupProduct();
        const task = await insertTask(members[0]!.memberId, values);
        const res = await call("DELETE", taskPath(productId, task.taskId), {
          cookie: members[1]!.cookie,
        });
        expect(res.status).toBe(403);
        expect(await findTask(task.taskId)).toBeDefined();
      });

      test("所属していない人は 404(プロダクトの存在を漏らさない)", async () => {
        const { productId, members } = await setupProduct();
        const task = await insertTask(members[0]!.memberId, values);
        const outsider = await createOutsider();
        const res = await call("DELETE", taskPath(productId, task.taskId), {
          cookie: outsider.cookie,
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
        expect(await findTask(task.taskId)).toBeDefined();
      });

      test("認証なしは 401", async () => {
        const { productId, members } = await setupProduct();
        const task = await insertTask(members[0]!.memberId, values);
        const res = await call("DELETE", taskPath(productId, task.taskId));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ message: "ログインが必要です" });
        expect(await findTask(task.taskId)).toBeDefined();
      });
    });
  }

  test("存在しないタスクを、メンバーが指定すると 403(タスクの有無は分からない)", async () => {
    const { productId, members } = await setupProduct();
    const res = await call("DELETE", taskPath(productId, crypto.randomUUID()), {
      cookie: members[0]!.cookie,
    });
    expect(res.status).toBe(403);
  });

  test("プロダクトから外されたメンバーは 404(以前は 403 だった人も)", async () => {
    const { productId, members, leader } = await setupProduct();
    const task = await insertTask(members[1]!.memberId);
    await removeMember(members[0]!.memberId);
    const res = await call("DELETE", taskPath(productId, task.taskId), {
      cookie: members[0]!.cookie,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
    expect(await findTask(task.taskId)).toBeDefined();
    // 残っているリーダーは削除できる
    expect(
      (await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie })).status
    ).toBe(204);
  });

  test("プロダクトから外されたリーダーは 404 で、削除できない", async () => {
    const { productId, members, leader } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    await promoteToLeader(members[1]!.memberId); // 別のリーダーがいる状態にする
    await removeMember(leader.memberId);
    const res = await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });
    expect(res.status).toBe(404);
    expect(await findTask(task.taskId)).toBeDefined();
  });

  test("リーダーが複数いるとき、どのリーダーでも削除できる", async () => {
    const { productId, members } = await setupProduct();
    await promoteToLeader(members[1]!.memberId);
    const task = await insertTask(members[0]!.memberId);
    const res = await call("DELETE", taskPath(productId, task.taskId), {
      cookie: members[1]!.cookie,
    });
    expect(res.status).toBe(204);
  });

  test("リーダーが他のリーダー担当のタスクも削除できる", async () => {
    const { productId, leader, members } = await setupProduct();
    await promoteToLeader(members[0]!.memberId);
    const task = await insertTask(members[0]!.memberId);
    const res = await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });
    expect(res.status).toBe(204);
  });

  test("あるプロダクトのリーダーが、自分がメンバーの別プロダクトのタスクを消そうとすると 403", async () => {
    // a のリーダーは、b ではメンバー
    const a = await setupProduct();
    const b = await setupProduct();
    const { db } = await import("../../src/db");
    const { productMembers } = await import("../../src/db/schema");
    await db
      .insert(productMembers)
      .values({ productId: b.productId, userId: a.leader.userId, role: "member" });
    const task = await insertTask(b.members[0]!.memberId);
    const res = await call("DELETE", taskPath(b.productId, task.taskId), { cookie: a.leader.cookie });
    expect(res.status).toBe(403);
    expect(await findTask(task.taskId)).toBeDefined();
  });
});

describe("DELETE タスク: 権限の拒否は副作用を残さない", () => {
  test("拒否されたあとも、担当メンバーとタスクの内容は変わらない", async () => {
    const { productId, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId, { taskName: "守るタスク" });
    await call("DELETE", taskPath(productId, task.taskId), { cookie: members[0]!.cookie });
    const after = await findTask(task.taskId);
    expect(after).toEqual(task);
    expect(await findMember(members[0]!.memberId)).toBeDefined();
  });
});
