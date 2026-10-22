import { afterAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { productTreeRoutes } from "../../src/routes/product-tree";
import { taskRoutes } from "../../src/routes/task";
import { deleteTaskRoutes } from "../../src/routes/task/delete-task";
import {
  cleanup,
  countTasks,
  createOutsider,
  findTask,
  insertTask,
  setupProduct,
} from "../task/helpers";

afterAll(cleanup);

// 削除 API と、削除後の確認に使う取得系 API をまとめたアプリ
const app = new Elysia().use(taskRoutes).use(deleteTaskRoutes).use(productTreeRoutes);

function call(method: string, path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return app.handle(new Request(`http://localhost${path}`, { method, headers }));
}

const path = (productId: string, taskId: string) => `/api/product/${productId}/task/${taskId}`;

async function treeTaskCount(productId: string, cookie: string) {
  const res = await call("GET", `/api/product/${productId}/tree`, cookie);
  expect(res.status).toBe(200);
  const tree = (await res.json()) as {
    leader: { tasks: unknown[] } | null;
    members: { tasks: unknown[] }[];
  };
  return [tree.leader, ...tree.members].reduce((n, node) => n + (node?.tasks.length ?? 0), 0);
}

describe("DELETE /api/product/:productId/task/:taskId", () => {
  describe("正常系", () => {
    test("リーダーは削除できて 204(本文なし)、DB から消える", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const res = await call("DELETE", path(productId, task.taskId), leader.cookie);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(await findTask(task.taskId)).toBeUndefined();
    });

    test("削除後、タスク取得は 404、一覧とツリーからも消える", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId, { taskName: "消すタスク" });
      await insertTask(members[0]!.memberId, { taskName: "残すタスク" });
      expect(await treeTaskCount(productId, leader.cookie)).toBe(2);

      expect((await call("DELETE", path(productId, task.taskId), leader.cookie)).status).toBe(204);

      expect((await call("GET", path(productId, task.taskId), leader.cookie)).status).toBe(404);
      expect(await treeTaskCount(productId, leader.cookie)).toBe(1);

      const list = await call("GET", `/api/product/${productId}/task`, leader.cookie);
      expect(list.status).toBe(200);
      expect(JSON.stringify(await list.json())).not.toContain(task.taskId);
    });

    test("他のタスク・他のプロダクトのタスクは残る", async () => {
      const a = await setupProduct();
      const b = await setupProduct();
      const target = await insertTask(a.members[0]!.memberId);
      const sameMember = await insertTask(a.members[0]!.memberId);
      const otherMember = await insertTask(a.members[1]!.memberId);
      const otherProduct = await insertTask(b.members[0]!.memberId);

      expect((await call("DELETE", path(a.productId, target.taskId), a.leader.cookie)).status).toBe(204);

      expect(await findTask(sameMember.taskId)).toBeDefined();
      expect(await findTask(otherMember.taskId)).toBeDefined();
      expect(await findTask(otherProduct.taskId)).toBeDefined();
      expect(await countTasks(a.productId)).toBe(2);
      expect(await countTasks(b.productId)).toBe(1);
    });

    test("非公開タスクもリーダーは削除できる", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId, { isVisible: false });
      expect((await call("DELETE", path(productId, task.taskId), leader.cookie)).status).toBe(204);
      expect(await findTask(task.taskId)).toBeUndefined();
    });

    test("リーダー自身が担当のタスクも削除できる", async () => {
      const { productId, leader } = await setupProduct();
      const task = await insertTask(leader.memberId);
      expect((await call("DELETE", path(productId, task.taskId), leader.cookie)).status).toBe(204);
      expect(await findTask(task.taskId)).toBeUndefined();
    });

    test("完了済み・完了報告済みのタスクも削除できる", async () => {
      const { productId, leader, members } = await setupProduct();
      const done = await insertTask(members[0]!.memberId, {
        reportedAt: new Date(),
        completedAt: new Date(),
      });
      const reported = await insertTask(members[0]!.memberId, { reportedAt: new Date() });
      expect((await call("DELETE", path(productId, done.taskId), leader.cookie)).status).toBe(204);
      expect((await call("DELETE", path(productId, reported.taskId), leader.cookie)).status).toBe(204);
      expect(await countTasks(productId)).toBe(0);
    });
  });

  describe("認証・権限", () => {
    test("cookie なしは 401", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const res = await call("DELETE", path(productId, task.taskId));
      expect(res.status).toBe(401);
      expect(await findTask(task.taskId)).toBeDefined();
    });

    test("メンバーは 403(自分が担当のタスクでも)で、消えない", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const own = await call("DELETE", path(productId, task.taskId), members[0]!.cookie);
      expect(own.status).toBe(403);
      expect(await own.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
      const other = await call("DELETE", path(productId, task.taskId), members[1]!.cookie);
      expect(other.status).toBe(403);
      expect(await findTask(task.taskId)).toBeDefined();
    });

    test("所属していないユーザーは 404 で、消えない", async () => {
      const { productId, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const outsider = await createOutsider();
      const res = await call("DELETE", path(productId, task.taskId), outsider.cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
      expect(await findTask(task.taskId)).toBeDefined();
    });

    test("存在しないプロダクトは 404", async () => {
      const { leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const res = await call("DELETE", path(crypto.randomUUID(), task.taskId), leader.cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
      expect(await findTask(task.taskId)).toBeDefined();
    });

    test("別のプロダクトのリーダーは、そのタスクを消せない(404)", async () => {
      const a = await setupProduct();
      const b = await setupProduct();
      const task = await insertTask(a.members[0]!.memberId);
      const res = await call("DELETE", path(b.productId, task.taskId), b.leader.cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
      expect(await findTask(task.taskId)).toBeDefined();
    });
  });

  describe("異常系", () => {
    test("存在しないタスクは 404", async () => {
      const { productId, leader } = await setupProduct();
      const res = await call("DELETE", path(productId, crypto.randomUUID()), leader.cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "タスクが見つかりません" });
    });

    test("UUID でない ID は 422", async () => {
      const { productId, leader } = await setupProduct();
      expect((await call("DELETE", path(productId, "abc"), leader.cookie)).status).toBe(422);
      expect((await call("DELETE", path("abc", crypto.randomUUID()), leader.cookie)).status).toBe(422);
    });

    test("二重削除は 2 回目が 404", async () => {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      expect((await call("DELETE", path(productId, task.taskId), leader.cookie)).status).toBe(204);
      const again = await call("DELETE", path(productId, task.taskId), leader.cookie);
      expect(again.status).toBe(404);
      expect(await again.json()).toEqual({ message: "タスクが見つかりません" });
    });
  });
});
