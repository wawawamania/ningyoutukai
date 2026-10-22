import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { assignKindRoutes } from "../../src/routes/task/assign-kind";
import {
  cleanup,
  createOutsider,
  createTaskType,
  findTask,
  insertTask,
  setupProduct,
} from "../task/helpers";

type Setup = Awaited<ReturnType<typeof setupProduct>>;
let a: Setup; // 検証するプロダクト
let b: Setup; // 別プロダクト

const app = new Elysia().use(assignKindRoutes);

const assign = (
  cookie: string | undefined,
  taskId: string,
  kindId: string,
  productId = a.productId
) =>
  app.handle(
    new Request(
      `http://localhost/api/product/${productId}/task/${taskId}/task_kinds/${kindId}`,
      { method: "PATCH", headers: cookie ? { cookie } : {} }
    )
  );

beforeAll(async () => {
  a = await setupProduct();
  b = await setupProduct();
});
afterAll(async () => {
  await cleanup();
});

describe("認証・権限", () => {
  test("cookie なしは 401", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const res = await assign(undefined, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(401);
  });

  test("所属していないユーザーは 404", async () => {
    const outsider = await createOutsider();
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const res = await assign(outsider.cookie, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
  });

  test("メンバーは 403(自分が担当のタスクでも)で変更されない", async () => {
    const m = a.members[0]!;
    const task = await insertTask(m.memberId);
    const kind = await createTaskType(a.productId);
    const res = await assign(m.cookie, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
  });

  test("非公開タスクでも、メンバーは 403(存在の有無で応答が変わらない)", async () => {
    const task = await insertTask(a.members[0]!.memberId, { isVisible: false });
    const kind = await createTaskType(a.productId);
    const res = await assign(a.members[1]!.cookie, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(403);
  });

  test("UUID でない値は 422", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    expect((await assign(a.leader.cookie, task.taskId, kind.taskTypeId, "abc")).status).toBe(422);
    expect((await assign(a.leader.cookie, "abc", kind.taskTypeId)).status).toBe(422);
    expect((await assign(a.leader.cookie, task.taskId, "abc")).status).toBe(422);
  });
});

describe("割り当て", () => {
  test("リーダーは種類を割り当てられ、変更後のタスクが返る", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskId).toBe(task.taskId);
    expect(body.taskTypeId).toBe(kind.taskTypeId);
    expect((await findTask(task.taskId))!.taskTypeId).toBe(kind.taskTypeId);
  });

  test("タスク詳細(GET)で種類が見える", async () => {
    const { request } = await import("../task/helpers");
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    await assign(a.leader.cookie, task.taskId, kind.taskTypeId);
    const res = await request("GET", `/api/product/${a.productId}/task/${task.taskId}`, {
      cookie: a.members[0]!.cookie,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).taskTypeId).toBe(kind.taskTypeId);
  });

  test("別の種類に変更できる", async () => {
    const k1 = await createTaskType(a.productId, "デザイン");
    const k2 = await createTaskType(a.productId, "コーディング");
    const task = await insertTask(a.members[0]!.memberId, { taskTypeId: k1.taskTypeId });
    const res = await assign(a.leader.cookie, task.taskId, k2.taskTypeId);
    expect(res.status).toBe(200);
    expect((await res.json()).taskTypeId).toBe(k2.taskTypeId);
  });

  test("同じ種類をもう一度割り当てても 200(冪等)", async () => {
    const kind = await createTaskType(a.productId);
    const task = await insertTask(a.members[0]!.memberId, { taskTypeId: kind.taskTypeId });
    const res = await assign(a.leader.cookie, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(200);
    expect((await res.json()).taskTypeId).toBe(kind.taskTypeId);
  });

  test("非公開タスクにも、リーダーは割り当てられる", async () => {
    const task = await insertTask(a.members[0]!.memberId, { isVisible: false });
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(200);
  });
});

describe("異常系", () => {
  test("別プロダクトの種類は 404 で変更されない", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const otherKind = await createTaskType(b.productId);
    const res = await assign(a.leader.cookie, task.taskId, otherKind.taskTypeId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクの種類が見つかりません" });
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
  });

  test("存在しない種類は 404", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const res = await assign(a.leader.cookie, task.taskId, crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクの種類が見つかりません" });
  });

  test("存在しないタスクは 404", async () => {
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, crypto.randomUUID(), kind.taskTypeId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
  });

  test("別プロダクトのタスクは 404 で変更されない", async () => {
    const other = await insertTask(b.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, other.taskId, kind.taskTypeId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
    expect((await findTask(other.taskId))!.taskTypeId).toBeNull();
  });

  test("完了済みのタスクは 409 で変更されない", async () => {
    const task = await insertTask(a.members[0]!.memberId, { completedAt: new Date() });
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "完了済みのタスクは変更できません" });
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
  });
});
