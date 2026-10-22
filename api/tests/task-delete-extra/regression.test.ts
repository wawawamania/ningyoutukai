import { afterAll, spyOn, test } from "bun:test";
import { expect } from "bun:test";
import { mailer } from "../../src/lib/mailer";
import { cleanup, insertTask, setupProduct } from "../task/helpers";
import { call, taskPath } from "./helpers";

/**
 * 回帰テスト: 削除と更新系の同時実行で 409 にならないこと(修正済み)。
 */

afterAll(cleanup);
spyOn(mailer, "send").mockResolvedValue({ ok: true });

const ROUNDS = 100;

/**
 * 削除と、タスク変更・完了確定・完了報告が同時に走ると、後者が 404 ではなく
 * 409(「完了済みのタスクは変更できません」など、事実と違うメッセージ)を返すことがある。
 * 原因: 取得(select)のあとに削除され、条件付き update が 0 件になった場合を 409 としている。
 * 期待: タスクが無いのだから 404 か、(削除より先に処理されたなら)200。
 * ほぼ毎回再現する(1 回ごとに 90% 以上)ので、100 回試して 1 度も 409 にならないことを期待する。
 */
async function raceStatuses(
  op: (ctx: Awaited<ReturnType<typeof setupProduct>>, taskId: string) => Promise<Response>
) {
  const ctx = await setupProduct();
  const statuses: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const task = await insertTask(ctx.members[0]!.memberId);
    const [, res] = await Promise.all([
      call("DELETE", taskPath(ctx.productId, task.taskId), { cookie: ctx.leader.cookie }),
      op(ctx, task.taskId),
    ]);
    statuses.push(res.status);
  }
  return statuses;
}

test("削除と同時のタスク変更(PATCH)が 409 にならない(404 か 200)", async () => {
  const statuses = await raceStatuses((c, id) =>
    call("PATCH", taskPath(c.productId, id), { cookie: c.leader.cookie, body: { taskName: "x" } })
  );
  expect(statuses.filter((s) => s === 409)).toEqual([]);
});

test("削除と同時の完了確定が 409 にならない(404 か 200)", async () => {
  const statuses = await raceStatuses((c, id) =>
    call("PATCH", `${taskPath(c.productId, id)}/complete`, { cookie: c.leader.cookie })
  );
  expect(statuses.filter((s) => s === 409)).toEqual([]);
});

test("削除と同時の完了報告が 409 にならない(404 か 200)", async () => {
  const statuses = await raceStatuses((c, id) =>
    call("POST", `${taskPath(c.productId, id)}/complete-report`, { cookie: c.members[0]!.cookie })
  );
  expect(statuses.filter((s) => s === 409)).toEqual([]);
});
