import { afterAll, describe, expect, test } from "bun:test";
import {
  cleanup,
  createOutsider,
  insertTask,
  request,
  setupProduct,
} from "./helpers";

afterAll(cleanup);

type TaskRow = {
  taskId: string;
  taskName: string;
  isVisible: boolean;
  completedAt: string | null;
  timeLimit: string | null;
  productMemberId: string;
};

async function list(productId: string, cookie?: string, query = "") {
  const res = await request("GET", `/api/product/${productId}/task${query}`, { cookie });
  return res;
}

async function listOk(productId: string, cookie: string, query = "") {
  const res = await list(productId, cookie, query);
  expect(res.status).toBe(200);
  return (await res.json()) as TaskRow[];
}

describe("GET /api/product/:productId/task 認証・所属", () => {
  test("cookie なしは 401", async () => {
    const { productId } = await setupProduct();
    expect((await list(productId)).status).toBe(401);
  });

  test("所属していないユーザーは 404", async () => {
    const { productId } = await setupProduct();
    const outsider = await createOutsider();
    const res = await list(productId, outsider.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });

  test("存在しないプロダクトは 404", async () => {
    const { leader } = await setupProduct();
    const res = await list(crypto.randomUUID(), leader.cookie);
    expect(res.status).toBe(404);
  });

  test("productId が uuid でなければ 422", async () => {
    const { leader } = await setupProduct();
    expect((await list("not-a-uuid", leader.cookie)).status).toBe(422);
  });

  test("タスクが無ければ空配列", async () => {
    const { productId, leader } = await setupProduct();
    expect(await listOk(productId, leader.cookie)).toEqual([]);
  });
});

describe("GET /api/product/:productId/task 可視性", () => {
  test("リーダーは非表示のタスクも含めて全部見える", async () => {
    const { productId, leader, members } = await setupProduct();
    const a = await insertTask(members[0]!.memberId, { isVisible: true });
    const b = await insertTask(members[1]!.memberId, { isVisible: false });
    const ids = (await listOk(productId, leader.cookie)).map((r) => r.taskId);
    expect(ids.sort()).toEqual([a.taskId, b.taskId].sort());
  });

  test("メンバーは公開タスクと自分が担当のタスクが見え、他人の非表示は見えない", async () => {
    const { productId, members } = await setupProduct();
    const [m1, m2] = members as [(typeof members)[0], (typeof members)[0]];
    const pub = await insertTask(m2.memberId, { isVisible: true });
    const hiddenOther = await insertTask(m2.memberId, { isVisible: false });
    const hiddenMine = await insertTask(m1.memberId, { isVisible: false });
    const ids = (await listOk(productId, m1.cookie)).map((r) => r.taskId);
    expect(ids).toContain(pub.taskId);
    expect(ids).toContain(hiddenMine.taskId);
    expect(ids).not.toContain(hiddenOther.taskId);
  });

  test("別プロダクトのタスクは含まれない", async () => {
    const p1 = await setupProduct();
    const p2 = await setupProduct();
    const t1 = await insertTask(p1.members[0]!.memberId);
    const t2 = await insertTask(p2.members[0]!.memberId);
    const ids1 = (await listOk(p1.productId, p1.leader.cookie)).map((r) => r.taskId);
    const ids2 = (await listOk(p2.productId, p2.leader.cookie)).map((r) => r.taskId);
    expect(ids1).toEqual([t1.taskId]);
    expect(ids2).toEqual([t2.taskId]);
  });

  test("レスポンスは taskColumns の形で日時は ISO 文字列", async () => {
    const { productId, leader, members } = await setupProduct();
    await insertTask(members[0]!.memberId, { timeLimit: new Date("2030-01-02T03:04:05Z") });
    const [row] = await listOk(productId, leader.cookie);
    expect(Object.keys(row!).sort()).toEqual(
      [
        "taskId", "taskName", "description", "timeLimit", "reportedAt",
        "completedAt", "taskTypeId", "productMemberId", "isVisible",
      ].sort()
    );
    expect(row!.timeLimit).toBe("2030-01-02T03:04:05.000Z");
  });
});

describe("GET /api/product/:productId/task 完了タスク", () => {
  test("既定では完了タスクを含めず、includeCompleted=true で含める", async () => {
    const { productId, leader, members } = await setupProduct();
    const open = await insertTask(members[0]!.memberId);
    const done = await insertTask(members[0]!.memberId, { completedAt: new Date() });

    const def = (await listOk(productId, leader.cookie)).map((r) => r.taskId);
    expect(def).toEqual([open.taskId]);

    const explicitFalse = (await listOk(productId, leader.cookie, "?includeCompleted=false")).map((r) => r.taskId);
    expect(explicitFalse).toEqual([open.taskId]);

    const all = (await listOk(productId, leader.cookie, "?includeCompleted=true")).map((r) => r.taskId);
    expect(all.sort()).toEqual([open.taskId, done.taskId].sort());
  });

  test("includeCompleted が不正な値なら 422", async () => {
    const { productId, leader } = await setupProduct();
    expect((await list(productId, leader.cookie, "?includeCompleted=abc")).status).toBe(422);
  });
});

describe("GET /api/product/:productId/task 並び順", () => {
  test("期限の昇順、期限なしは最後、同じ期限は taskId 昇順", async () => {
    const { productId, leader, members } = await setupProduct();
    const m = members[0]!.memberId;
    const late = await insertTask(m, { timeLimit: new Date("2031-01-01T00:00:00Z") });
    const noLimit1 = await insertTask(m, { timeLimit: null });
    const early = await insertTask(m, { timeLimit: new Date("2030-01-01T00:00:00Z") });
    const sameA = await insertTask(m, { timeLimit: new Date("2030-06-01T00:00:00Z") });
    const sameB = await insertTask(m, { timeLimit: new Date("2030-06-01T00:00:00Z") });
    const noLimit2 = await insertTask(m, { timeLimit: null });

    const [s1, s2] = [sameA.taskId, sameB.taskId].sort();
    const [n1, n2] = [noLimit1.taskId, noLimit2.taskId].sort();
    const ids = (await listOk(productId, leader.cookie)).map((r) => r.taskId);
    expect(ids).toEqual([early.taskId, s1!, s2!, late.taskId, n1!, n2!]);
  });
});
