import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, createTaskType, findTask, insertTask, setupProduct } from "../task/helpers";
import { app, assign, assignPath, call } from "./helpers";

type Setup = Awaited<ReturnType<typeof setupProduct>>;
let a: Setup;
let b: Setup;

beforeAll(async () => {
  a = await setupProduct();
  b = await setupProduct();
});
afterAll(async () => {
  await cleanup();
});

describe("パスの入力の境界", () => {
  test("大文字の UUID でも割り当てられる", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const res = await assign(
      a.leader.cookie,
      a.productId.toUpperCase(),
      task.taskId.toUpperCase(),
      kind.taskTypeId.toUpperCase()
    );
    expect(res.status).toBe(200);
    expect((await res.json()).taskTypeId).toBe(kind.taskTypeId);
  });

  test("後ろに空白がある UUID は 422(日本語メッセージ)で変更されない", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, a.productId, task.taskId, `${kind.taskTypeId}%20`);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toContain("入力が正しくありません");
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
  });

  test("UUID でない値(null・数字・SQL 断片・1 文字足りない)は 422 で、本文は { message } のみ", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    for (const bad of ["null", "0", "'; DROP TABLE tasks;--", "123e4567-e89b-12d3-a456-42661417400"]) {
      const res = await assign(a.leader.cookie, a.productId, task.taskId, encodeURIComponent(bad));
      expect(res.status).toBe(422);
      expect(Object.keys(await res.json())).toEqual(["message"]);
    }
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
  });

  test("形式エラーは権限の判定より先に出る(メンバーでも 422)", async () => {
    const res = await assign(a.members[0]!.cookie, a.productId, "abc", "def");
    expect(res.status).toBe(422);
  });

  test("本文があっても無視され、種類はパスの kindId になる", async () => {
    const task = await insertTask(a.members[0]!.memberId, { taskName: "元の名前" });
    const kind = await createTaskType(a.productId);
    const other = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId, {
      taskTypeId: other.taskTypeId,
      taskName: "書き換え",
      completedAt: new Date().toISOString(),
      isVisible: false,
    });
    expect(res.status).toBe(200);
    const row = (await findTask(task.taskId))!;
    expect(row.taskTypeId).toBe(kind.taskTypeId);
    expect(row.taskName).toBe("元の名前");
    expect(row.completedAt).toBeNull();
    expect(row.isVisible).toBe(true);
  });

  test("壊れた JSON の本文では、成功するか、日本語の { message } で 400 になる", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const res = await app.handle(
      new Request(`http://localhost${assignPath(a.productId, task.taskId, kind.taskTypeId)}`, {
        method: "PATCH",
        headers: { cookie: a.leader.cookie, "content-type": "application/json" },
        body: "{broken",
      })
    );
    expect([200, 400]).toContain(res.status);
    if (res.status === 400) {
      expect(await res.json()).toEqual({ message: "リクエストの形式が正しくありません" });
    }
  });

  test("別プロダクトのリーダーが、自分のプロダクトの URL で他プロダクトのタスクを指定しても 404", async () => {
    const taskA = await insertTask(a.members[0]!.memberId);
    const kindB = await createTaskType(b.productId);
    const res = await assign(b.leader.cookie, b.productId, taskA.taskId, kindB.taskTypeId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
    expect((await findTask(taskA.taskId))!.taskTypeId).toBeNull();
  });

  test("A のリーダーが B のプロダクトの URL を使うと 404(所属していない)", async () => {
    const taskB = await insertTask(b.members[0]!.memberId);
    const kindB = await createTaskType(b.productId);
    const res = await assign(a.leader.cookie, b.productId, taskB.taskId, kindB.taskTypeId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
    expect((await findTask(taskB.taskId))!.taskTypeId).toBeNull();
  });

  test("PATCH 以外のメソッドでは割り当てられない", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    for (const method of ["PUT", "POST", "DELETE"]) {
      const res = await call(method, assignPath(a.productId, task.taskId, kind.taskTypeId), a.leader.cookie);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
  });
});
