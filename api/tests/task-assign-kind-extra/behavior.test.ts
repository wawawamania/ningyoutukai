import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { taskTypes } from "../../src/db/schema";
import { cleanup, createTaskType, findTask, insertTask, setupProduct } from "../task/helpers";
import { assign, call } from "./helpers";

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

const taskKeys = [
  "taskId",
  "taskName",
  "description",
  "timeLimit",
  "reportedAt",
  "completedAt",
  "taskTypeId",
  "productMemberId",
  "isVisible",
].sort();

describe("応答の形", () => {
  test("update-task の応答と同じキー・同じ値の形で、余計なフィールドが無い", async () => {
    const task = await insertTask(a.members[0]!.memberId, {
      taskName: "形の確認",
      description: "説明",
      timeLimit: new Date("2030-01-01T00:00:00Z"),
      isVisible: false,
    });
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(taskKeys);
    expect(body).toEqual({
      taskId: task.taskId,
      taskName: "形の確認",
      description: "説明",
      timeLimit: "2030-01-01T00:00:00.000Z",
      reportedAt: null,
      completedAt: null,
      taskTypeId: kind.taskTypeId,
      productMemberId: a.members[0]!.memberId,
      isVisible: false,
    });

    // 同じタスクを update-task で更新した応答と、キーが一致する
    const upd = await call("PATCH", `/api/product/${a.productId}/task/${task.taskId}`, a.leader.cookie, {
      taskName: "形の確認2",
    });
    expect(Object.keys(await upd.json()).sort()).toEqual(taskKeys);
  });

  test("説明・期限が null のタスクでも null のまま返る", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const body = await (await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId)).json();
    expect(body.description).toBeNull();
    expect(body.timeLimit).toBeNull();
    expect(body.reportedAt).toBeNull();
  });

  test("種類以外の項目(名前・説明・期限・報告済み・公開設定・担当)は変わらない", async () => {
    const reportedAt = new Date("2029-05-05T00:00:00Z");
    const task = await insertTask(a.members[1]!.memberId, {
      taskName: "そのまま",
      description: "d",
      timeLimit: new Date("2031-02-03T00:00:00Z"),
      reportedAt,
      isVisible: false,
    });
    const kind = await createTaskType(a.productId);
    await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    const after = (await findTask(task.taskId))!;
    expect({ ...after, taskTypeId: null }).toEqual({ ...task, taskTypeId: null });
    expect(after.taskTypeId).toBe(kind.taskTypeId);
  });
});

describe("データの分離", () => {
  test("割り当てで、同じ担当者・同じプロダクトの他のタスクの種類は変わらない", async () => {
    const k0 = await createTaskType(a.productId);
    const k1 = await createTaskType(a.productId);
    const target = await insertTask(a.members[0]!.memberId);
    const sibling = await insertTask(a.members[0]!.memberId, { taskTypeId: k0.taskTypeId });
    const noKind = await insertTask(a.members[0]!.memberId);
    const otherProduct = await insertTask(b.members[0]!.memberId);
    await assign(a.leader.cookie, a.productId, target.taskId, k1.taskTypeId);
    expect((await findTask(target.taskId))!.taskTypeId).toBe(k1.taskTypeId);
    expect((await findTask(sibling.taskId))!.taskTypeId).toBe(k0.taskTypeId);
    expect((await findTask(noKind.taskId))!.taskTypeId).toBeNull();
    expect((await findTask(otherProduct.taskId))!.taskTypeId).toBeNull();
  });

  test("種類の名前・プロダクトは変わらない", async () => {
    const kind = await createTaskType(a.productId, "コーディング");
    const task = await insertTask(a.members[0]!.memberId);
    await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    const [row] = await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, kind.taskTypeId));
    expect(row).toEqual(kind);
  });

  test("リーダー自身のタスクにも割り当てられる", async () => {
    const task = await insertTask(a.leader.memberId);
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(200);
  });
});

describe("冪等性・二重実行", () => {
  test("同じ割り当てを 2 回: 応答が同じで、データも変わらない", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const r1 = await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    const r2 = await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual(await r1.json());
  });

  test("同じ割り当てを同時に 5 回: すべて 200", async () => {
    const task = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId))
    );
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await findTask(task.taskId))!.taskTypeId).toBe(kind.taskTypeId);
  });

  test("別の種類を同時に 2 回: どちらも 200 で、最終的にどちらかの種類(壊れない)", async () => {
    for (let i = 0; i < 5; i++) {
      const task = await insertTask(a.members[0]!.memberId);
      const k1 = await createTaskType(a.productId);
      const k2 = await createTaskType(a.productId);
      const [r1, r2] = await Promise.all([
        assign(a.leader.cookie, a.productId, task.taskId, k1.taskTypeId),
        assign(a.leader.cookie, a.productId, task.taskId, k2.taskTypeId),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const final = (await findTask(task.taskId))!;
      expect([k1.taskTypeId, k2.taskTypeId]).toContain(final.taskTypeId!);
      expect(final.completedAt).toBeNull();
    }
  });

  test("種類を割り当てて、別の種類に変えて、また戻せる", async () => {
    const k1 = await createTaskType(a.productId);
    const k2 = await createTaskType(a.productId);
    const task = await insertTask(a.members[0]!.memberId);
    for (const k of [k1, k2, k1]) {
      const res = await assign(a.leader.cookie, a.productId, task.taskId, k.taskTypeId);
      expect((await res.json()).taskTypeId).toBe(k.taskTypeId);
    }
  });
});

describe("完了との競合", () => {
  test("割り当てと完了確定を同時に行うと、完了になり、どちらの結果でも壊れない", async () => {
    for (let i = 0; i < 5; i++) {
      const task = await insertTask(a.members[0]!.memberId);
      const kind = await createTaskType(a.productId);
      const [ra, rc] = await Promise.all([
        assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId),
        call("PATCH", `/api/product/${a.productId}/task/${task.taskId}/complete`, a.leader.cookie),
      ]);
      // 完了確定は常に成功する(割り当てが先でも後でも)。割り当ては 200(先)か 409(後)
      expect(rc.status).toBe(200);
      expect([200, 409]).toContain(ra.status);
      const final = (await findTask(task.taskId))!;
      expect(final.completedAt).not.toBeNull();
      if (ra.status === 200) expect(final.taskTypeId).toBe(kind.taskTypeId);
      else {
        expect(await ra.json()).toEqual({ message: "完了済みのタスクは変更できません" });
        expect(final.taskTypeId).toBeNull();
      }
    }
  });

  test("完了確定の後の割り当ては 409 で、種類は変わらない", async () => {
    const k1 = await createTaskType(a.productId);
    const k2 = await createTaskType(a.productId);
    const task = await insertTask(a.members[0]!.memberId, { taskTypeId: k1.taskTypeId });
    await call("PATCH", `/api/product/${a.productId}/task/${task.taskId}/complete`, a.leader.cookie);
    const res = await assign(a.leader.cookie, a.productId, task.taskId, k2.taskTypeId);
    expect(res.status).toBe(409);
    expect((await findTask(task.taskId))!.taskTypeId).toBe(k1.taskTypeId);
  });

  test("報告済み(未確定)のタスクには割り当てられる", async () => {
    const task = await insertTask(a.members[0]!.memberId, { reportedAt: new Date() });
    const kind = await createTaskType(a.productId);
    const res = await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(200);
    expect((await findTask(task.taskId))!.reportedAt).not.toBeNull();
  });
});

describe("反映(詳細・一覧・メンバー別一覧・ツリー)", () => {
  test("割り当て後、各 API に種類が反映される。非公開タスクはメンバーに漏れない", async () => {
    const kind = await createTaskType(a.productId, "反映確認");
    const m = a.members[0]!;
    const pub = await insertTask(m.memberId, { taskName: "公開" });
    const hidden = await insertTask(m.memberId, { taskName: "非公開", isVisible: false });
    await assign(a.leader.cookie, a.productId, pub.taskId, kind.taskTypeId);
    await assign(a.leader.cookie, a.productId, hidden.taskId, kind.taskTypeId);

    const detail = await call("GET", `/api/product/${a.productId}/task/${pub.taskId}`, a.members[1]!.cookie);
    expect((await detail.json()).taskTypeId).toBe(kind.taskTypeId);

    const list = await (await call("GET", `/api/product/${a.productId}/task`, a.leader.cookie)).json();
    const listed = (list as { taskId: string; taskTypeId: string | null }[]).filter((t) =>
      [pub.taskId, hidden.taskId].includes(t.taskId)
    );
    expect(listed.map((t) => t.taskTypeId)).toEqual([kind.taskTypeId, kind.taskTypeId]);

    const memberList = await (
      await call("GET", `/api/product/${a.productId}/member/${m.memberId}/task`, a.members[1]!.cookie)
    ).json();
    const ids = (memberList as { taskId: string; taskTypeId: string | null }[]).map((t) => t.taskId);
    expect(ids).toContain(pub.taskId);
    expect(ids).not.toContain(hidden.taskId);

    // 他のメンバーから非公開タスクの詳細は見えない
    const hiddenDetail = await call("GET", `/api/product/${a.productId}/task/${hidden.taskId}`, a.members[1]!.cookie);
    expect(hiddenDetail.status).toBe(404);

    // ツリー: taskType が { taskTypeId, taskTypeName } で入る
    const tree = await (await call("GET", `/api/product/${a.productId}/tree`, a.leader.cookie)).json();
    const node = (tree.members as { productMemberId: string; tasks: any[] }[]).find(
      (n) => n.productMemberId === m.memberId
    )!;
    const t = node.tasks.find((x) => x.taskId === pub.taskId);
    expect(t.taskType).toEqual({ taskTypeId: kind.taskTypeId, taskTypeName: expect.stringContaining("反映確認") });

    // メンバー視点のツリーでは、非公開タスクは出ない
    const treeM = await (await call("GET", `/api/product/${a.productId}/tree`, a.members[1]!.cookie)).json();
    const nodeM = (treeM.members as { productMemberId: string; tasks: any[] }[]).find(
      (n) => n.productMemberId === m.memberId
    )!;
    expect(nodeM.tasks.some((x) => x.taskId === hidden.taskId)).toBe(false);
  });

  test("完了確定したタスクはツリーから消える(種類を割り当て済みでも)", async () => {
    const kind = await createTaskType(a.productId);
    const task = await insertTask(a.members[0]!.memberId, { taskName: "消える" });
    await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    await call("PATCH", `/api/product/${a.productId}/task/${task.taskId}/complete`, a.leader.cookie);
    const tree = await (await call("GET", `/api/product/${a.productId}/tree`, a.leader.cookie)).json();
    const all = (tree.members as { tasks: { taskId: string }[] }[]).flatMap((n) => n.tasks);
    expect(all.some((x) => x.taskId === task.taskId)).toBe(false);
  });

  test("割り当て済みの種類を消す(set null)と、タスクは残り種類が外れる", async () => {
    const kind = await createTaskType(a.productId);
    const task = await insertTask(a.members[0]!.memberId);
    await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    await db.delete(taskTypes).where(eq(taskTypes.taskTypeId, kind.taskTypeId));
    expect((await findTask(task.taskId))!.taskTypeId).toBeNull();
    // 消した種類は 404
    const res = await assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクの種類が見つかりません" });
  });
});

describe("エラー本文の形式", () => {
  test("すべての異常応答が { message: 日本語の文字列 } のみ", async () => {
    const task = await insertTask(a.members[0]!.memberId, { completedAt: new Date() });
    const live = await insertTask(a.members[0]!.memberId);
    const kind = await createTaskType(a.productId);
    const otherKind = await createTaskType(b.productId);
    const responses = await Promise.all([
      assign(undefined, a.productId, live.taskId, kind.taskTypeId),
      assign(a.members[0]!.cookie, a.productId, live.taskId, kind.taskTypeId),
      assign(a.leader.cookie, b.productId, live.taskId, kind.taskTypeId),
      assign(a.leader.cookie, a.productId, crypto.randomUUID(), kind.taskTypeId),
      assign(a.leader.cookie, a.productId, live.taskId, otherKind.taskTypeId),
      assign(a.leader.cookie, a.productId, task.taskId, kind.taskTypeId),
      assign(a.leader.cookie, a.productId, "x", kind.taskTypeId),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 403, 404, 404, 404, 409, 422]);
    for (const r of responses) {
      const j = await r.json();
      expect(Object.keys(j)).toEqual(["message"]);
      expect(j.message).toMatch(/[ぁ-んァ-ン一-龥]/);
    }
  });
});
