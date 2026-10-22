import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mailer } from "../../src/lib/mailer";
import {
  cleanup,
  createOutsider,
  findTask,
  insertTask,
  request,
  setupProduct,
} from "./helpers";

afterAll(cleanup);

let sendSpy: ReturnType<typeof spyOn<typeof mailer, "send">>;
beforeEach(() => {
  sendSpy = spyOn(mailer, "send").mockResolvedValue({ ok: true });
});
afterEach(() => sendSpy.mockRestore());

const path = (productId: string, taskId: string) =>
  `/api/product/${productId}/task/${taskId}/complete`;

describe("PATCH /api/product/:productId/task/:taskId/complete", () => {
  describe("認証・権限", () => {
    test("cookie なしは 401", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const res = await request("PATCH", path(productId, task.taskId));
      expect(res.status).toBe(401);
      expect((await findTask(task.taskId))!.completedAt).toBeNull();
    });

    test("所属していないユーザーは 404", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const outsider = await createOutsider();
      const res = await request("PATCH", path(productId, task.taskId), { cookie: outsider.cookie });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
      expect((await findTask(task.taskId))!.completedAt).toBeNull();
    });

    test("存在しないプロダクトは 404", async () => {
      const { leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const res = await request("PATCH", path(crypto.randomUUID(), task.taskId), {
        cookie: leader.cookie,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
    });

    test("メンバーは 403(自分が担当のタスクでも)", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId, { reportedAt: new Date() });
      const res = await request("PATCH", path(productId, task.taskId), {
        cookie: members[0]!.cookie,
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
      expect((await findTask(task.taskId))!.completedAt).toBeNull();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    test("productId が uuid でなければ 422", async () => {
      const { leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const res = await request("PATCH", path("not-a-uuid", task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(422);
    });

    test("taskId が uuid でなければ 422", async () => {
      const { productId, leader } = await setupProduct();
      const res = await request("PATCH", path(productId, "not-a-uuid"), { cookie: leader.cookie });
      expect(res.status).toBe(422);
    });
  });

  describe("対象タスク", () => {
    test("存在しない taskId は 404", async () => {
      const { productId, leader } = await setupProduct();
      const res = await request("PATCH", path(productId, crypto.randomUUID()), {
        cookie: leader.cookie,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
      expect(sendSpy).not.toHaveBeenCalled();
    });

    test("別プロダクトのタスクは 404 で、完了にならない", async () => {
      const a = await setupProduct();
      const b = await setupProduct();
      const otherTask = await insertTask(b.members[0]!.memberId);
      const res = await request("PATCH", path(a.productId, otherTask.taskId), {
        cookie: a.leader.cookie,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
      expect((await findTask(otherTask.taskId))!.completedAt).toBeNull();
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe("完了処理", () => {
    test("リーダーが完了にでき、他の項目は変わらない", async () => {
      const { productId, leader, members } = await setupProduct();
      const timeLimit = new Date("2030-01-01T00:00:00.000Z");
      const task = await insertTask(members[0]!.memberId, {
        taskName: "完了対象",
        description: "説明",
        timeLimit,
      });
      const before = Date.now();
      const res = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.taskId).toBe(task.taskId);
      expect(body.taskName).toBe("完了対象");
      expect(body.description).toBe("説明");
      expect(body.timeLimit).toBe(timeLimit.toISOString());
      expect(body.productMemberId).toBe(members[0]!.memberId);
      expect(body.isVisible).toBe(task.isVisible);
      expect(body.reportedAt).toBeNull();
      expect(new Date(body.completedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

      const row = (await findTask(task.taskId))!;
      expect(row.completedAt).not.toBeNull();
      expect(row.completedAt!.toISOString()).toBe(body.completedAt);
      expect(row.taskName).toBe("完了対象");
      expect(row.description).toBe("説明");
      expect(row.timeLimit!.toISOString()).toBe(timeLimit.toISOString());
    });

    test("報告済みのタスクを完了にでき、reportedAt は変わらない", async () => {
      const { productId, leader, members } = await setupProduct();
      const reportedAt = new Date("2030-02-03T04:05:06.000Z");
      const task = await insertTask(members[0]!.memberId, { reportedAt });
      const res = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.reportedAt).toBe(reportedAt.toISOString());
      expect(body.completedAt).not.toBeNull();
      const row = (await findTask(task.taskId))!;
      expect(row.reportedAt!.toISOString()).toBe(reportedAt.toISOString());
      expect(row.completedAt).not.toBeNull();
    });

    test("報告なしのタスクも完了にできる", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[1]!.memberId);
      const res = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(200);
      const row = (await findTask(task.taskId))!;
      expect(row.reportedAt).toBeNull();
      expect(row.completedAt).not.toBeNull();
    });

    test("非表示のタスクもリーダーは完了にできる", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId, { isVisible: false });
      const res = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(200);
      expect((await res.json()).isVisible).toBe(false);
      expect((await findTask(task.taskId))!.completedAt).not.toBeNull();
    });

    test("リーダー自身が担当のタスクも完了にできる", async () => {
      const { productId, leader } = await setupProduct();
      const task = await insertTask(leader.memberId);
      const res = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(200);
      expect((await findTask(task.taskId))!.completedAt).not.toBeNull();
    });

    test("すでに完了しているタスクは 409 で、completedAt は変わらない", async () => {
      const { productId, leader, members } = await setupProduct();
      const completedAt = new Date("2030-03-03T03:03:03.000Z");
      const task = await insertTask(members[0]!.memberId, { completedAt });
      const res = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ message: "すでに完了しています" });
      expect((await findTask(task.taskId))!.completedAt!.toISOString()).toBe(
        completedAt.toISOString()
      );
      expect(sendSpy).not.toHaveBeenCalled();
    });

    test("続けて 2 回呼ぶと 2 回目は 409", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const first = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(first.status).toBe(200);
      const completedAt = (await findTask(task.taskId))!.completedAt!;
      const second = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(second.status).toBe(409);
      expect((await findTask(task.taskId))!.completedAt!.getTime()).toBe(completedAt.getTime());
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("メール通知", () => {
    test("成功すると担当者に 1 通送る", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId, { taskName: "通知テスト用タスク" });
      const res = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(200);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const mail = sendSpy.mock.calls[0]![0];
      expect(mail.to).toBe(members[0]!.email);
      expect(mail.subject).toBe("タスクが完了になりました: 通知テスト用タスク");
      expect(mail.text).toContain("通知テスト用タスク");
    });

    test("担当者がリーダー自身でも送る", async () => {
      const { productId, leader } = await setupProduct();
      const task = await insertTask(leader.memberId);
      await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0]![0].to).toBe(leader.email);
    });

    test("メール送信が失敗しても 200", async () => {
      sendSpy.mockResolvedValue({ ok: false, error: "boom" });
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const res = await request("PATCH", path(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(200);
      expect((await findTask(task.taskId))!.completedAt).not.toBeNull();
    });
  });
});
