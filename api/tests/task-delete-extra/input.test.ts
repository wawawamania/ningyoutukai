import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, findTask, insertTask, setupProduct } from "../task/helpers";
import { call, taskPath } from "./helpers";

afterAll(cleanup);

describe("DELETE タスク: 入力の境界", () => {
  test("UUID でない taskId は 422 で、タスクは消えない", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    const bad = [
      "abc",
      "123",
      "null",
      "undefined",
      "%20",
      `%20${task.taskId}`,
      `${task.taskId}%20`,
      `${task.taskId}x`,
      task.taskId.replaceAll("-", ""),
      "00000000-0000-0000-0000-00000000000g",
      "'; DROP TABLE tasks; --",
    ];
    for (const id of bad) {
      const res = await call("DELETE", `/api/product/${productId}/task/${encodeURI(id)}`, {
        cookie: leader.cookie,
      });
      expect([id, res.status]).toEqual([id, 422]);
    }
    expect(await findTask(task.taskId)).toBeDefined();
  });

  test("UUID でない productId は 422", async () => {
    const { leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    for (const id of ["abc", "%20", "1"]) {
      const res = await call("DELETE", `/api/product/${id}/task/${task.taskId}`, {
        cookie: leader.cookie,
      });
      expect([id, res.status]).toEqual([id, 422]);
    }
    expect(await findTask(task.taskId)).toBeDefined();
  });

  test("422 の本文は message を含む JSON(スタックトレースなどを漏らさない)", async () => {
    const { productId, leader } = await setupProduct();
    const res = await call("DELETE", taskPath(productId, "abc"), { cookie: leader.cookie });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: unknown };
    expect(typeof body.message).toBe("string");
    expect(JSON.stringify(body)).not.toContain("node_modules");
  });

  test("認証なしで不正な ID でも、401 か 422 で 500 にならない", async () => {
    const { productId } = await setupProduct();
    const res = await call("DELETE", taskPath(productId, "abc"));
    expect([401, 422]).toContain(res.status);
  });

  test("大文字の UUID でも同じタスクを削除でき、204", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    const res = await call(
      "DELETE",
      taskPath(productId.toUpperCase(), task.taskId.toUpperCase()),
      { cookie: leader.cookie }
    );
    expect(res.status).toBe(204);
    expect(await findTask(task.taskId)).toBeUndefined();
  });

  test("NIL UUID は 404(500 にならない)", async () => {
    const { productId, leader } = await setupProduct();
    const nil = "00000000-0000-0000-0000-000000000000";
    const task = await call("DELETE", taskPath(productId, nil), { cookie: leader.cookie });
    expect(task.status).toBe(404);
    const product = await call("DELETE", taskPath(nil, nil), { cookie: leader.cookie });
    expect(product.status).toBe(404);
  });

  test("別のプロダクトのタスク ID を指定すると 404 で、タスクは消えない(リーダー同士)", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    const task = await insertTask(a.members[0]!.memberId);
    const res = await call("DELETE", taskPath(b.productId, task.taskId), { cookie: b.leader.cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
    expect(await findTask(task.taskId)).toBeDefined();
  });

  test("自分がリーダーでないプロダクトの URL にタスク ID を差し替えても消せない", async () => {
    // a のリーダーが、b のタスク ID を a の URL で指定
    const a = await setupProduct();
    const b = await setupProduct();
    const task = await insertTask(b.members[0]!.memberId);
    const res = await call("DELETE", taskPath(a.productId, task.taskId), { cookie: a.leader.cookie });
    expect(res.status).toBe(404);
    expect(await findTask(task.taskId)).toBeDefined();
  });

  test("タスク ID の末尾スラッシュ・クエリ・本文が付いても 204 で削除でき、500 にならない", async () => {
    const { productId, leader, members } = await setupProduct();
    const t1 = await insertTask(members[0]!.memberId);
    const withQuery = await call("DELETE", `${taskPath(productId, t1.taskId)}?force=true`, {
      cookie: leader.cookie,
    });
    expect(withQuery.status).toBe(204);

    const t2 = await insertTask(members[0]!.memberId);
    const withBody = await call("DELETE", taskPath(productId, t2.taskId), {
      cookie: leader.cookie,
      body: { taskId: crypto.randomUUID() },
    });
    expect(withBody.status).toBe(204);
    // 本文の taskId は無視され、URL のタスクだけが消える
    expect(await findTask(t2.taskId)).toBeUndefined();

    const t3 = await insertTask(members[0]!.memberId);
    const slash = await call("DELETE", `${taskPath(productId, t3.taskId)}/`, {
      cookie: leader.cookie,
    });
    expect([204, 404]).toContain(slash.status);
  });

  test("壊れた・改ざんされた cookie は 401 で、タスクは消えない", async () => {
    const { productId, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    for (const cookie of ["better-auth.session_token=xxx", "foo=bar", "better-auth.session_token="]) {
      const res = await call("DELETE", taskPath(productId, task.taskId), { cookie });
      expect([cookie, res.status]).toEqual([cookie, 401]);
    }
    expect(await findTask(task.taskId)).toBeDefined();
  });

  test("リーダーの cookie の末尾を 1 文字変えると 401(署名の検証)", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    const tampered = leader.cookie.slice(0, -3) + "AAA";
    const res = await call("DELETE", taskPath(productId, task.taskId), { cookie: tampered });
    expect(res.status).toBe(401);
    expect(await findTask(task.taskId)).toBeDefined();
  });
});
