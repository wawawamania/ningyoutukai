import { afterAll, describe, expect, test } from "bun:test";
import {
  cleanup,
  createOutsider,
  insertTask,
  request,
  setupProduct,
} from "./helpers";

afterAll(cleanup);

const url = (productId: string, memberId: string, query = "") =>
  `/api/product/${productId}/member/${memberId}/task${query}`;

type TaskJson = { taskId: string; taskName: string; productMemberId: string };
const names = (list: TaskJson[]) => list.map((x) => x.taskName);

describe("GET /api/product/:productId/member/:memberId/task 認証・存在確認", () => {
  test("cookie なしは 401", async () => {
    const { productId, members } = await setupProduct();
    const res = await request("GET", url(productId, members[0]!.memberId));
    expect(res.status).toBe(401);
  });

  test("所属していないユーザーは 404(プロダクトが見つかりません)", async () => {
    const { productId, members } = await setupProduct();
    const outsider = await createOutsider();
    const res = await request("GET", url(productId, members[0]!.memberId), {
      cookie: outsider.cookie,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });

  test("存在しないプロダクトは 404", async () => {
    const { leader, members } = await setupProduct();
    const res = await request(
      "GET",
      url(crypto.randomUUID(), members[0]!.memberId),
      { cookie: leader.cookie }
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });

  test("productId が uuid でないと 422", async () => {
    const { leader, members } = await setupProduct();
    const res = await request("GET", url("abc", members[0]!.memberId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(422);
  });

  test("memberId が uuid でないと 422", async () => {
    const { productId, leader } = await setupProduct();
    const res = await request("GET", url(productId, "abc"), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(422);
  });

  test("memberId が存在しないと 404(メンバーが見つかりません)", async () => {
    const { productId, leader } = await setupProduct();
    const res = await request("GET", url(productId, crypto.randomUUID()), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "メンバーが見つかりません" });
  });

  test("別プロダクトのメンバーの memberId は 404(メンバーが見つかりません)", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    await insertTask(b.members[0]!.memberId, { taskName: "他プロダクト" });
    const res = await request("GET", url(a.productId, b.members[0]!.memberId), {
      cookie: a.leader.cookie,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "メンバーが見つかりません" });
  });

  test("タスクが無ければ空配列(200)", async () => {
    const { productId, leader, members } = await setupProduct();
    const res = await request("GET", url(productId, members[0]!.memberId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /api/product/:productId/member/:memberId/task 可視性", () => {
  test("リーダーはメンバーの全タスク(非表示も含む)を見られる", async () => {
    const { productId, leader, members } = await setupProduct();
    const m = members[0]!;
    await insertTask(m.memberId, { taskName: "公開" });
    await insertTask(m.memberId, { taskName: "非表示", isVisible: false });
    const res = await request("GET", url(productId, m.memberId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(200);
    expect(names(await res.json()).sort()).toEqual(["公開", "非表示"]);
  });

  test("メンバーが他のメンバーのタスクを見ると公開タスクだけ", async () => {
    const { productId, members } = await setupProduct();
    const [viewer, other] = members as [(typeof members)[0], (typeof members)[0]];
    await insertTask(other.memberId, { taskName: "公開" });
    await insertTask(other.memberId, { taskName: "非表示", isVisible: false });
    const res = await request("GET", url(productId, other.memberId), {
      cookie: viewer.cookie,
    });
    expect(res.status).toBe(200);
    expect(names(await res.json())).toEqual(["公開"]);
  });

  test("メンバーが自分の memberId を指定すると非表示も含めて見える", async () => {
    const { productId, members } = await setupProduct();
    const me = members[0]!;
    await insertTask(me.memberId, { taskName: "公開" });
    await insertTask(me.memberId, { taskName: "非表示", isVisible: false });
    const res = await request("GET", url(productId, me.memberId), {
      cookie: me.cookie,
    });
    expect(res.status).toBe(200);
    expect(names(await res.json()).sort()).toEqual(["公開", "非表示"]);
  });

  test("指定したメンバー担当のタスクだけで、他のメンバーのタスクは含まれない", async () => {
    const { productId, leader, members } = await setupProduct();
    const [m1, m2] = members as [(typeof members)[0], (typeof members)[0]];
    await insertTask(m1.memberId, { taskName: "m1のタスク" });
    await insertTask(m2.memberId, { taskName: "m2のタスク" });
    await insertTask(leader.memberId, { taskName: "リーダーのタスク" });
    const res = await request("GET", url(productId, m1.memberId), {
      cookie: leader.cookie,
    });
    const list: TaskJson[] = await res.json();
    expect(names(list)).toEqual(["m1のタスク"]);
    expect(list[0]!.productMemberId).toBe(m1.memberId);
  });

  test("リーダー自身の memberId を指定するとリーダー担当のタスクが見える", async () => {
    const { productId, leader, members } = await setupProduct();
    await insertTask(leader.memberId, { taskName: "リーダーのタスク" });
    await insertTask(members[0]!.memberId, { taskName: "メンバーのタスク" });
    const res = await request("GET", url(productId, leader.memberId), {
      cookie: leader.cookie,
    });
    expect(names(await res.json())).toEqual(["リーダーのタスク"]);
  });

  test("レスポンスは taskColumns の形(日時は ISO 文字列)", async () => {
    const { productId, leader, members } = await setupProduct();
    const limit = new Date("2030-01-02T03:04:05.000Z");
    const task = await insertTask(members[0]!.memberId, {
      taskName: "形",
      description: "説明",
      timeLimit: limit,
    });
    const res = await request("GET", url(productId, members[0]!.memberId), {
      cookie: leader.cookie,
    });
    expect(await res.json()).toEqual([
      {
        taskId: task.taskId,
        taskName: "形",
        description: "説明",
        timeLimit: "2030-01-02T03:04:05.000Z",
        reportedAt: null,
        completedAt: null,
        taskTypeId: null,
        productMemberId: members[0]!.memberId,
        isVisible: true,
      },
    ]);
  });
});

describe("GET /api/product/:productId/member/:memberId/task 完了タスクと並び順", () => {
  test("完了したタスクは既定で含まれない", async () => {
    const { productId, leader, members } = await setupProduct();
    const m = members[0]!;
    await insertTask(m.memberId, { taskName: "未完了" });
    await insertTask(m.memberId, { taskName: "完了", completedAt: new Date() });
    const res = await request("GET", url(productId, m.memberId), {
      cookie: leader.cookie,
    });
    expect(names(await res.json())).toEqual(["未完了"]);
  });

  test("includeCompleted=true で完了したタスクも含まれる", async () => {
    const { productId, leader, members } = await setupProduct();
    const m = members[0]!;
    await insertTask(m.memberId, { taskName: "未完了" });
    await insertTask(m.memberId, { taskName: "完了", completedAt: new Date() });
    const res = await request(
      "GET",
      url(productId, m.memberId, "?includeCompleted=true"),
      { cookie: leader.cookie }
    );
    expect(names(await res.json()).sort()).toEqual(["完了", "未完了"]);
  });

  test("includeCompleted=false なら完了したタスクは含まれない", async () => {
    const { productId, leader, members } = await setupProduct();
    const m = members[0]!;
    await insertTask(m.memberId, { taskName: "完了", completedAt: new Date() });
    const res = await request(
      "GET",
      url(productId, m.memberId, "?includeCompleted=false"),
      { cookie: leader.cookie }
    );
    expect(await res.json()).toEqual([]);
  });

  test("includeCompleted=abc は 422", async () => {
    const { productId, leader, members } = await setupProduct();
    const res = await request(
      "GET",
      url(productId, members[0]!.memberId, "?includeCompleted=abc"),
      { cookie: leader.cookie }
    );
    expect(res.status).toBe(422);
  });

  test("期限の昇順、期限なしは最後、同じ期限は taskId の昇順", async () => {
    const { productId, leader, members } = await setupProduct();
    const m = members[0]!;
    const noLimit = await insertTask(m.memberId, { taskName: "期限なし" });
    const late = await insertTask(m.memberId, {
      taskName: "遅い",
      timeLimit: new Date("2031-01-01T00:00:00Z"),
    });
    const early = await insertTask(m.memberId, {
      taskName: "早い",
      timeLimit: new Date("2030-01-01T00:00:00Z"),
    });
    const same = new Date("2030-06-01T00:00:00Z");
    const sameA = await insertTask(m.memberId, { taskName: "同じ1", timeLimit: same });
    const sameB = await insertTask(m.memberId, { taskName: "同じ2", timeLimit: same });
    const noLimit2 = await insertTask(m.memberId, { taskName: "期限なし2" });

    const res = await request("GET", url(productId, m.memberId), {
      cookie: leader.cookie,
    });
    const list: TaskJson[] = await res.json();

    const sameIds = [sameA.taskId, sameB.taskId].sort();
    const noLimitIds = [noLimit.taskId, noLimit2.taskId].sort();
    expect(list.map((x) => x.taskId)).toEqual([
      early.taskId,
      ...sameIds,
      late.taskId,
      ...noLimitIds,
    ]);
  });
});
