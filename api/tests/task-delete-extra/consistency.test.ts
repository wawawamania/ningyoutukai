import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { mailer } from "../../src/lib/mailer";
import { cleanup, countTasks, createTaskType, findTask, insertTask, setupProduct } from "../task/helpers";
import { call, findMember, removeMember, taskPath } from "./helpers";

afterAll(cleanup);

const mailSpy = spyOn(mailer, "send").mockResolvedValue({ ok: true });
afterEach(() => mailSpy.mockClear());

type Tree = {
  leader: { tasks: { taskId: string }[] } | null;
  members: { tasks: { taskId: string }[] }[];
};

async function treeTaskIds(productId: string, cookie: string) {
  const res = await call("GET", `/api/product/${productId}/tree`, { cookie });
  expect(res.status).toBe(200);
  const tree = (await res.json()) as Tree;
  return [tree.leader, ...tree.members].flatMap((n) => n?.tasks.map((t) => t.taskId) ?? []);
}

describe("DELETE タスク: 応答の形", () => {
  test("204 は本文が空で、content-type や content-length に中身を示さない", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    const res = await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const length = res.headers.get("content-length");
    expect(length === null || length === "0").toBe(true);
  });

  test("エラーは { message } だけの JSON(日本語)", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    const cases = [
      await call("DELETE", taskPath(productId, crypto.randomUUID()), { cookie: leader.cookie }),
      await call("DELETE", taskPath(productId, task.taskId), { cookie: members[0]!.cookie }),
      await call("DELETE", taskPath(productId, task.taskId)),
    ];
    for (const res of cases) {
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(["message"]);
      expect(String(body.message)).toMatch(/[ぁ-んァ-ン一-龥]/);
    }
  });
});

describe("DELETE タスク: 冪等性と二重実行", () => {
  test("2 回目は 404 で、3 回目も 404", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie })).status);
    }
    expect(codes).toEqual([204, 404, 404]);
  });

  test("同時に 2 回削除すると、204 が 1 つと 404 が 1 つ(500 にならない)", async () => {
    const { productId, leader, members } = await setupProduct();
    for (let i = 0; i < 5; i++) {
      const task = await insertTask(members[0]!.memberId);
      const results = await Promise.all([
        call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie }),
        call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
      expect(await findTask(task.taskId)).toBeUndefined();
    }
  });

  test("同時に 10 回削除しても、204 はちょうど 1 つで、残りは 404", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie })
      )
    );
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 204)).toHaveLength(1);
    expect(codes.filter((c) => c === 404)).toHaveLength(9);
  });

  test("複数のタスクを同時に削除しても、それぞれ 204 で全部消える", async () => {
    const { productId, leader, members } = await setupProduct();
    const list = await Promise.all(
      Array.from({ length: 8 }, (_, i) => insertTask(members[i % 2]!.memberId))
    );
    const results = await Promise.all(
      list.map((t) => call("DELETE", taskPath(productId, t.taskId), { cookie: leader.cookie }))
    );
    expect(results.every((r) => r.status === 204)).toBe(true);
    expect(await countTasks(productId)).toBe(0);
  });

  test("別々のプロダクトで同時に削除しても、互いに干渉しない", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    const ta = await insertTask(a.members[0]!.memberId);
    const tb = await insertTask(b.members[0]!.memberId);
    const [ra, rb] = await Promise.all([
      call("DELETE", taskPath(a.productId, ta.taskId), { cookie: a.leader.cookie }),
      call("DELETE", taskPath(b.productId, tb.taskId), { cookie: b.leader.cookie }),
    ]);
    expect([ra.status, rb.status]).toEqual([204, 204]);
  });
});

describe("DELETE タスク: データの分離", () => {
  test("削除してもメンバー・タスクの種類・同じ種類の他のタスクは残る", async () => {
    const { productId, leader, members } = await setupProduct();
    const type = await createTaskType(productId);
    const target = await insertTask(members[0]!.memberId, { taskTypeId: type.taskTypeId });
    const sibling = await insertTask(members[0]!.memberId, { taskTypeId: type.taskTypeId });
    expect(
      (await call("DELETE", taskPath(productId, target.taskId), { cookie: leader.cookie })).status
    ).toBe(204);
    expect(await findMember(members[0]!.memberId)).toBeDefined();
    const left = await findTask(sibling.taskId);
    expect(left?.taskTypeId).toBe(type.taskTypeId);
  });

  test("他のタスクの内容(名前・状態)は変わらない", async () => {
    const { productId, leader, members } = await setupProduct();
    const target = await insertTask(members[0]!.memberId, { taskName: "消す" });
    const keep = await insertTask(members[0]!.memberId, {
      taskName: "残す",
      description: "説明",
      isVisible: false,
      reportedAt: new Date(),
    });
    await call("DELETE", taskPath(productId, target.taskId), { cookie: leader.cookie });
    expect(await findTask(keep.taskId)).toEqual(keep);
  });

  test("拒否(403/404)された削除では、どのタスクも消えない", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    await insertTask(a.members[0]!.memberId);
    await insertTask(b.members[0]!.memberId);
    const taskOfA = await insertTask(a.members[1]!.memberId);
    await call("DELETE", taskPath(a.productId, taskOfA.taskId), { cookie: a.members[0]!.cookie });
    await call("DELETE", taskPath(b.productId, taskOfA.taskId), { cookie: b.leader.cookie });
    await call("DELETE", taskPath(a.productId, taskOfA.taskId));
    expect(await countTasks(a.productId)).toBe(2);
    expect(await countTasks(b.productId)).toBe(1);
  });
});

describe("DELETE タスク: 削除後の整合", () => {
  test("詳細・一覧・メンバーのタスク一覧・ツリーから消え、他のタスクは残る", async () => {
    const { productId, leader, members } = await setupProduct();
    const target = await insertTask(members[0]!.memberId, { taskName: "消すタスク" });
    const keep = await insertTask(members[0]!.memberId, { taskName: "残すタスク" });
    expect(await treeTaskIds(productId, leader.cookie)).toContain(target.taskId);

    expect(
      (await call("DELETE", taskPath(productId, target.taskId), { cookie: leader.cookie })).status
    ).toBe(204);

    for (const cookie of [leader.cookie, members[0]!.cookie]) {
      expect((await call("GET", taskPath(productId, target.taskId), { cookie })).status).toBe(404);
      const list = await call("GET", `/api/product/${productId}/task`, { cookie });
      const text = JSON.stringify(await list.json());
      expect(text).not.toContain(target.taskId);
      expect(text).toContain(keep.taskId);
      const mine = await call(
        "GET",
        `/api/product/${productId}/member/${members[0]!.memberId}/task`,
        { cookie }
      );
      expect(mine.status).toBe(200);
      const mineText = JSON.stringify(await mine.json());
      expect(mineText).not.toContain(target.taskId);
      expect(mineText).toContain(keep.taskId);
    }
    const ids = await treeTaskIds(productId, leader.cookie);
    expect(ids).not.toContain(target.taskId);
    expect(ids).toContain(keep.taskId);
  });

  test("削除後に、変更・完了確定・完了報告をすると 404(復活しない)", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });

    const patch = await call("PATCH", taskPath(productId, task.taskId), {
      cookie: leader.cookie,
      body: { taskName: "復活?" },
    });
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ message: "タスクが見つかりません" });

    const complete = await call("PATCH", `${taskPath(productId, task.taskId)}/complete`, {
      cookie: leader.cookie,
    });
    expect(complete.status).toBe(404);

    const report = await call("POST", `${taskPath(productId, task.taskId)}/complete-report`, {
      cookie: members[0]!.cookie,
    });
    expect(report.status).toBe(404);
    expect(await report.json()).toEqual({ message: "タスクが見つかりません" });

    expect(await findTask(task.taskId)).toBeUndefined();
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("メンバーがプロダクトから外れて消えたタスクは、削除すると 404", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    await removeMember(members[0]!.memberId); // タスクも cascade で消える
    const res = await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });
    expect(res.status).toBe(404);
  });
});

describe("DELETE タスク: メール通知への影響", () => {
  test("完了報告のあとに削除しても落ちず、削除ではメールを送らない", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId);
    const report = await call("POST", `${taskPath(productId, task.taskId)}/complete-report`, {
      cookie: members[0]!.cookie,
    });
    expect(report.status).toBe(200);
    expect(mailSpy).toHaveBeenCalledTimes(1);

    const del = await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });
    expect(del.status).toBe(204);
    expect(mailSpy).toHaveBeenCalledTimes(1);
  });

  test("完了確定のあとに削除しても落ちない", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId, { reportedAt: new Date() });
    const done = await call("PATCH", `${taskPath(productId, task.taskId)}/complete`, {
      cookie: leader.cookie,
    });
    expect(done.status).toBe(200);
    const del = await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });
    expect(del.status).toBe(204);
  });

  test("完了報告済みのタスクの削除は、メールを送らない", async () => {
    const { productId, leader, members } = await setupProduct();
    const task = await insertTask(members[0]!.memberId, { reportedAt: new Date() });
    const del = await call("DELETE", taskPath(productId, task.taskId), { cookie: leader.cookie });
    expect(del.status).toBe(204);
    expect(mailSpy).not.toHaveBeenCalled();
  });
});
