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

const send = spyOn(mailer, "send");
beforeEach(() => {
  send.mockClear();
  send.mockResolvedValue({ ok: true });
});
afterEach(() => send.mockClear());

const url = (productId: string, taskId: string) =>
  `/api/product/${productId}/task/${taskId}/complete-report`;

describe("POST /api/product/:productId/task/:taskId/complete-report", () => {
  describe("認証・存在確認", () => {
    test("cookie なしは 401", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0].memberId);
      const res = await request("POST", url(productId, task.taskId));
      expect(res.status).toBe(401);
      expect(send).not.toHaveBeenCalled();
    });

    test("所属していないユーザーは 404", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0].memberId);
      const outsider = await createOutsider();
      const res = await request("POST", url(productId, task.taskId), { cookie: outsider.cookie });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
      expect(send).not.toHaveBeenCalled();
    });

    test("存在しないプロダクトは 404", async () => {
      const { leader, members } = await setupProduct();
      const task = await insertTask(members[0].memberId);
      const res = await request("POST", url(crypto.randomUUID(), task.taskId), {
        cookie: leader.cookie,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
    });

    test("productId が uuid でないと 422", async () => {
      const { leader } = await setupProduct();
      const res = await request("POST", url("not-a-uuid", crypto.randomUUID()), {
        cookie: leader.cookie,
      });
      expect(res.status).toBe(422);
    });

    test("taskId が uuid でないと 422", async () => {
      const { productId, leader } = await setupProduct();
      const res = await request("POST", url(productId, "not-a-uuid"), { cookie: leader.cookie });
      expect(res.status).toBe(422);
    });

    test("存在しない taskId は 404", async () => {
      const { productId, members } = await setupProduct();
      const res = await request("POST", url(productId, crypto.randomUUID()), {
        cookie: members[0].cookie,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
    });

    test("別プロダクトのタスクは 404", async () => {
      const a = await setupProduct();
      const b = await setupProduct();
      const taskOfB = await insertTask(b.members[0].memberId);
      const res = await request("POST", url(a.productId, taskOfB.taskId), {
        cookie: a.members[0].cookie,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
      expect((await findTask(taskOfB.taskId)).reportedAt).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("報告できる人", () => {
    test("担当者本人(メンバー)は報告でき、reportedAt だけが入る", async () => {
      const { productId, members } = await setupProduct();
      const me = members[0];
      const task = await insertTask(me.memberId, {
        taskName: "報告するタスク",
        description: "説明",
        timeLimit: new Date("2030-01-01T00:00:00.000Z"),
      });

      const before = Date.now();
      const res = await request("POST", url(productId, task.taskId), { cookie: me.cookie });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.taskId).toBe(task.taskId);
      expect(body.completedAt).toBeNull();
      expect(typeof body.reportedAt).toBe("string");
      expect(new Date(body.reportedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(body.taskName).toBe("報告するタスク");
      expect(body.description).toBe("説明");
      expect(body.timeLimit).toBe("2030-01-01T00:00:00.000Z");
      expect(body.productMemberId).toBe(me.memberId);
      expect(body.isVisible).toBe(task.isVisible);
      expect(body.taskTypeId).toBe(task.taskTypeId);

      const row = await findTask(task.taskId);
      expect(row.reportedAt).not.toBeNull();
      expect(row.completedAt).toBeNull();
      expect(row.taskName).toBe(task.taskName);
      expect(row.description).toBe(task.description);
      expect(row.timeLimit).toEqual(task.timeLimit);
      expect(row.productMemberId).toBe(task.productMemberId);
      expect(row.isVisible).toBe(task.isVisible);
    });

    test("担当者本人は非表示のタスクも報告できる", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0].memberId, { isVisible: false });
      const res = await request("POST", url(productId, task.taskId), {
        cookie: members[0].cookie,
      });
      expect(res.status).toBe(200);
      expect((await findTask(task.taskId)).reportedAt).not.toBeNull();
    });

    test("リーダー自身が担当のタスクは、リーダーが報告できる", async () => {
      const { productId, leader } = await setupProduct();
      const task = await insertTask(leader.memberId);
      const res = await request("POST", url(productId, task.taskId), { cookie: leader.cookie });
      expect(res.status).toBe(200);
      expect((await findTask(task.taskId)).reportedAt).not.toBeNull();
      expect(send).toHaveBeenCalledTimes(1);
    });

    test("担当者でない別のメンバーは(公開タスクでも)403", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0].memberId, { isVisible: true });
      const res = await request("POST", url(productId, task.taskId), {
        cookie: members[1].cookie,
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ message: "担当者のみ完了を報告できます" });
      expect((await findTask(task.taskId)).reportedAt).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    test("非表示の他人のタスクはメンバーには 404", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0].memberId, { isVisible: false });
      const res = await request("POST", url(productId, task.taskId), {
        cookie: members[1].cookie,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
      expect((await findTask(task.taskId)).reportedAt).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    test("リーダーでも担当者でなければ 403(非表示のタスクでも)", async () => {
      const { productId, leader, members } = await setupProduct();
      for (const isVisible of [true, false]) {
        const task = await insertTask(members[0].memberId, { isVisible });
        const res = await request("POST", url(productId, task.taskId), {
          cookie: leader.cookie,
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ message: "担当者のみ完了を報告できます" });
        expect((await findTask(task.taskId)).reportedAt).toBeNull();
      }
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("状態の検証", () => {
    test("すでに報告済みは 409 で、reportedAt は変わらない", async () => {
      const { productId, members } = await setupProduct();
      const reportedAt = new Date("2030-01-01T00:00:00.000Z");
      const task = await insertTask(members[0].memberId, { reportedAt });
      const res = await request("POST", url(productId, task.taskId), {
        cookie: members[0].cookie,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ message: "すでに報告済みです" });
      expect((await findTask(task.taskId)).reportedAt).toEqual(reportedAt);
      expect(send).not.toHaveBeenCalled();
    });

    test("2 回続けて報告すると 2 回目は 409", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0].memberId);
      const first = await request("POST", url(productId, task.taskId), {
        cookie: members[0].cookie,
      });
      expect(first.status).toBe(200);
      const reportedAt = (await findTask(task.taskId)).reportedAt;
      const second = await request("POST", url(productId, task.taskId), {
        cookie: members[0].cookie,
      });
      expect(second.status).toBe(409);
      expect((await findTask(task.taskId)).reportedAt).toEqual(reportedAt);
      expect(send).toHaveBeenCalledTimes(1);
    });

    test("すでに完了しているタスクは 409", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0].memberId, { completedAt: new Date() });
      const res = await request("POST", url(productId, task.taskId), {
        cookie: members[0].cookie,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ message: "すでに完了しています" });
      expect((await findTask(task.taskId)).reportedAt).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("メール通知", () => {
    test("成功すると、リーダー宛てに 1 回送られる", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0].memberId, { taskName: "ロゴを作る" });
      const res = await request("POST", url(productId, task.taskId), {
        cookie: members[0].cookie,
      });
      expect(res.status).toBe(200);

      expect(send).toHaveBeenCalledTimes(1);
      const [mail] = send.mock.calls[0]!;
      expect(mail.subject).toBe("タスクの完了報告: ロゴを作る");
      expect(mail.text).toContain("ロゴを作る");
      expect(mail.text).toContain("member1");
    });

    test("宛先にはリーダーのメールアドレスが入る", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[1].memberId);
      await request("POST", url(productId, task.taskId), { cookie: members[1].cookie });
      expect(send).toHaveBeenCalledTimes(1);
      const [mail] = send.mock.calls[0]!;
      expect(mail.to).toEqual([leader.email]);
      expect(mail.text).toContain("member2");
    });

    test("メール送信が失敗しても API は成功する", async () => {
      const { productId, members } = await setupProduct();
      send.mockResolvedValue({ ok: false, error: "boom" });
      const task = await insertTask(members[0].memberId);
      const res = await request("POST", url(productId, task.taskId), {
        cookie: members[0].cookie,
      });
      expect(res.status).toBe(200);
      expect((await findTask(task.taskId)).reportedAt).not.toBeNull();
    });
  });
});
