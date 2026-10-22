import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanup,
  createOutsider,
  createTaskType,
  insertTask,
  request,
  setupProduct,
} from "./helpers";

afterAll(cleanup);

let p: Awaited<ReturnType<typeof setupProduct>>;
const get = (productId: string, taskId: string, cookie?: string) =>
  request("GET", `/api/product/${productId}/task/${taskId}`, { cookie });
const NO_PRODUCT = { message: "プロダクトが見つかりません" };
const NO_TASK = { message: "タスクが見つかりません" };

beforeAll(async () => {
  p = await setupProduct({ members: 2 });
});

describe("GET /api/product/:productId/task/:taskId 認証と入力", () => {
  test("cookie なしは 401", async () => {
    const task = await insertTask(p.members[0]!.memberId);
    const res = await get(p.productId, task.taskId);
    expect(res.status).toBe(401);
  });

  test("所属していないユーザーは 404(プロダクトが見つかりません)", async () => {
    const task = await insertTask(p.members[0]!.memberId);
    const outsider = await createOutsider();
    const res = await get(p.productId, task.taskId, outsider.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NO_PRODUCT);
  });

  test("存在しないプロダクトは 404", async () => {
    const res = await get(crypto.randomUUID(), crypto.randomUUID(), p.leader.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NO_PRODUCT);
  });

  test("productId が uuid でないと 422", async () => {
    const res = await get("not-a-uuid", crypto.randomUUID(), p.leader.cookie);
    expect(res.status).toBe(422);
  });

  test("taskId が uuid でないと 422", async () => {
    const res = await get(p.productId, "not-a-uuid", p.leader.cookie);
    expect(res.status).toBe(422);
  });
});

describe("GET /api/product/:productId/task/:taskId 取得", () => {
  test("リーダーが取得でき、タスクの形で返る", async () => {
    const type = await createTaskType(p.productId);
    const timeLimit = new Date("2030-01-02T03:04:05.000Z");
    const task = await insertTask(p.members[0]!.memberId, {
      taskName: "取得テスト",
      description: "説明文",
      timeLimit,
      taskTypeId: type.taskTypeId,
    });
    const res = await get(p.productId, task.taskId, p.leader.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      taskId: task.taskId,
      taskName: "取得テスト",
      description: "説明文",
      timeLimit: "2030-01-02T03:04:05.000Z",
      reportedAt: null,
      completedAt: null,
      taskTypeId: type.taskTypeId,
      productMemberId: p.members[0]!.memberId,
      isVisible: true,
    });
  });

  test("メンバーは他メンバー担当の公開タスクも取得できる", async () => {
    const task = await insertTask(p.members[0]!.memberId, { isVisible: true });
    const res = await get(p.productId, task.taskId, p.members[1]!.cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).taskId).toBe(task.taskId);
  });

  test("存在しない taskId は 404(タスクが見つかりません)", async () => {
    const res = await get(p.productId, crypto.randomUUID(), p.leader.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NO_TASK);
  });

  test("別プロダクトのタスクは、自分の所属するプロダクトの URL では 404", async () => {
    const other = await setupProduct({ members: 1 });
    const otherTask = await insertTask(other.members[0]!.memberId);
    const res = await get(p.productId, otherTask.taskId, p.leader.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NO_TASK);
    // 正しい URL なら取得できる
    const ok = await get(other.productId, otherTask.taskId, other.leader.cookie);
    expect(ok.status).toBe(200);
  });

  test("完了済みタスクも 200 で取得でき、completedAt が入っている", async () => {
    const done = new Date("2030-05-06T07:08:09.000Z");
    const task = await insertTask(p.members[0]!.memberId, {
      reportedAt: done,
      completedAt: done,
    });
    const res = await get(p.productId, task.taskId, p.members[0]!.cookie);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.completedAt).toBe("2030-05-06T07:08:09.000Z");
    expect(json.reportedAt).toBe("2030-05-06T07:08:09.000Z");
  });
});

describe("GET /api/product/:productId/task/:taskId 可視性", () => {
  test("メンバーは他メンバー担当の非表示タスクを取得すると 404", async () => {
    const task = await insertTask(p.members[0]!.memberId, { isVisible: false });
    const res = await get(p.productId, task.taskId, p.members[1]!.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NO_TASK);
  });

  test("自分が担当の非表示タスクは取得できる", async () => {
    const task = await insertTask(p.members[0]!.memberId, { isVisible: false });
    const res = await get(p.productId, task.taskId, p.members[0]!.cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).isVisible).toBe(false);
  });

  test("リーダーは非表示タスクも取得できる", async () => {
    const task = await insertTask(p.members[0]!.memberId, { isVisible: false });
    const res = await get(p.productId, task.taskId, p.leader.cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).taskId).toBe(task.taskId);
  });
});
