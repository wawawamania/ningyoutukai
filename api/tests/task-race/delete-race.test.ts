import { afterAll, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { tasks } from "../../src/db/schema";
import { mailer } from "../../src/lib/mailer";
import { cleanup, insertTask, request, setupProduct } from "../task/helpers";

afterAll(cleanup);
spyOn(mailer, "send").mockResolvedValue({ ok: true });

const ROUNDS = 100;

/**
 * 更新系の API と、タスクの削除(DB へ直接 delete)を同時に走らせる。
 * 取得(select)のあとに削除され、条件付き update が 0 件になった場合、
 * 「完了済み・報告済み」の 409 ではなく、404(削除済み)を返すこと。
 * 確率的なテストなので、100 回試して 1 度も 409 にならないことを期待する。
 */
async function raceStatuses(
  op: (ctx: Awaited<ReturnType<typeof setupProduct>>, taskId: string) => Promise<Response>
) {
  const ctx = await setupProduct();
  const statuses: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const task = await insertTask(ctx.members[0]!.memberId);
    const [, res] = await Promise.all([
      // API の認可・取得(数 ms)の途中に削除が割り込むよう、遅延を 0〜9ms でずらす
      Bun.sleep(i % 10).then(() => db.delete(tasks).where(eq(tasks.taskId, task.taskId))),
      op(ctx, task.taskId),
    ]);
    statuses.push(res.status);
  }
  return statuses;
}

const path = (productId: string, taskId: string) => `/api/product/${productId}/task/${taskId}`;

test("削除と同時のタスク変更(PATCH)が 409 にならない(404 か 200)", async () => {
  const statuses = await raceStatuses((c, id) =>
    request("PATCH", path(c.productId, id), { cookie: c.leader.cookie, body: { taskName: "x" } })
  );
  expect(statuses.filter((s) => s === 409)).toEqual([]);
});

test("削除と同時の完了確定が 409 にならない(404 か 200)", async () => {
  const statuses = await raceStatuses((c, id) =>
    request("PATCH", `${path(c.productId, id)}/complete`, { cookie: c.leader.cookie })
  );
  expect(statuses.filter((s) => s === 409)).toEqual([]);
});

test("削除と同時の完了報告が 409 にならない(404 か 200)", async () => {
  const statuses = await raceStatuses((c, id) =>
    request("POST", `${path(c.productId, id)}/complete-report`, {
      cookie: c.members[0]!.cookie,
    })
  );
  expect(statuses.filter((s) => s === 409)).toEqual([]);
});
