import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { productTreeRoutes } from "../../src/routes/product-tree";
import {
  cleanup,
  createOutsider,
  createTaskType,
  insertTask,
  setupProduct,
} from "../task/helpers";

// ツリー表示 API(GET /api/product/:productId/tree)

const app = new Elysia().use(productTreeRoutes);
const get = (path: string, cookie?: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} }));

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
type Node = { productMemberId: string; tasks: { taskName: string; taskType: { taskTypeName: string } | null }[] };

let p: Ctx;

beforeAll(async () => {
  p = await setupProduct({ members: 2 });
  const type = await createTaskType(p.productId, "デザイン");
  const [m1, m2] = p.members;
  // リーダー自身のタスク
  await insertTask(p.leader.memberId, {
    taskName: "リーダーのタスク",
    timeLimit: new Date("2026-11-01T00:00:00Z"),
  });
  // メンバー1: 公開(種類あり)、非表示、完了済み、期限なし
  await insertTask(m1!.memberId, {
    taskName: "m1-公開",
    taskTypeId: type.taskTypeId,
    timeLimit: new Date("2026-12-01T00:00:00Z"),
  });
  await insertTask(m1!.memberId, {
    taskName: "m1-非表示",
    isVisible: false,
    timeLimit: new Date("2026-10-30T00:00:00Z"),
  });
  await insertTask(m1!.memberId, { taskName: "m1-完了済み", completedAt: new Date() });
  await insertTask(m1!.memberId, { taskName: "m1-期限なし" });
  // メンバー2: 公開、非表示
  await insertTask(m2!.memberId, { taskName: "m2-公開" });
  await insertTask(m2!.memberId, { taskName: "m2-非表示", isVisible: false });
});
afterAll(cleanup);

const url = () => `/api/product/${p.productId}/tree`;
const names = (node: Node) => node.tasks.map((t) => t.taskName);
const nodeOf = (members: Node[], memberId: string) =>
  members.find((m) => m.productMemberId === memberId)!;

describe("認証・所属", () => {
  it("未ログインは 401", async () => {
    expect((await get(url())).status).toBe(401);
  });

  it("所属していないユーザーは 404", async () => {
    const outsider = await createOutsider();
    const res = await get(url(), outsider.cookie);
    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("プロダクトが見つかりません");
  });

  it("存在しないプロダクトは 404", async () => {
    const res = await get(`/api/product/${crypto.randomUUID()}/tree`, p.leader.cookie);
    expect(res.status).toBe(404);
  });

  it("productId が uuid でないと 422", async () => {
    expect((await get("/api/product/abc/tree", p.leader.cookie)).status).toBe(422);
  });
});

describe("リーダーから見たツリー", () => {
  it("形: product、leader、members を返す", async () => {
    const res = await get(url(), p.leader.cookie);
    expect(res.status).toBe(200);
    const tree = await res.json();
    expect(Object.keys(tree).sort()).toEqual([
      "leader",
      "members",
      "product",
      "viewerProductMemberId",
    ]);
    expect(tree.viewerProductMemberId).toBe(p.leader.memberId);
    expect(tree.product.productId).toBe(p.productId);
    expect(tree.leader.role).toBe("leader");
    expect(tree.leader.productMemberId).toBe(p.leader.memberId);
    expect(tree.members).toHaveLength(2);
    expect(Object.keys(tree.members[0]).sort()).toEqual([
      "avatarUrl",
      "productMemberId",
      "role",
      "tasks",
      "userId",
      "userName",
    ]);
  });

  it("リーダー自身のタスクは leader に入る", async () => {
    const tree = await (await get(url(), p.leader.cookie)).json();
    expect(names(tree.leader)).toEqual(["リーダーのタスク"]);
  });

  it("非表示のタスクも見える。完了済みは出ない", async () => {
    const tree = await (await get(url(), p.leader.cookie)).json();
    const all = (tree.members as Node[]).flatMap(names);
    expect(all).toContain("m1-非表示");
    expect(all).toContain("m2-非表示");
    expect(all).not.toContain("m1-完了済み");
  });

  it("タスクは期限の昇順で、期限なしは最後", async () => {
    const tree = await (await get(url(), p.leader.cookie)).json();
    const m1 = nodeOf(tree.members, p.members[0]!.memberId);
    expect(names(m1)).toEqual(["m1-非表示", "m1-公開", "m1-期限なし"]);
  });

  it("タスクの種類は名前つきで返り、未設定は null", async () => {
    const tree = await (await get(url(), p.leader.cookie)).json();
    const m1 = nodeOf(tree.members, p.members[0]!.memberId);
    const typed = m1.tasks.find((t) => t.taskName === "m1-公開")!;
    expect(typed.taskType?.taskTypeName).toContain("デザイン");
    const untyped = m1.tasks.find((t) => t.taskName === "m1-期限なし")!;
    expect(untyped.taskType).toBeNull();
  });

  it("日時は ISO 文字列、未設定は null で返る", async () => {
    const tree = await (await get(url(), p.leader.cookie)).json();
    const m1 = nodeOf(tree.members, p.members[0]!.memberId);
    const withLimit = m1.tasks.find((t) => t.taskName === "m1-公開") as unknown as {
      timeLimit: string;
      reportedAt: null;
    };
    expect(new Date(withLimit.timeLimit).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(withLimit.reportedAt).toBeNull();
    const noLimit = m1.tasks.find((t) => t.taskName === "m1-期限なし") as unknown as {
      timeLimit: null;
    };
    expect(noLimit.timeLimit).toBeNull();
  });
});

describe("メンバーから見たツリー", () => {
  it("公開のタスクと、自分が担当のタスクだけが見える", async () => {
    const tree = await (await get(url(), p.members[0]!.cookie)).json();
    // 自分の非表示は見える
    expect(names(nodeOf(tree.members, p.members[0]!.memberId))).toContain("m1-非表示");
    // 他のメンバーの非表示は見えない
    expect(names(nodeOf(tree.members, p.members[1]!.memberId))).toEqual(["m2-公開"]);
    expect(names(tree.leader)).toEqual(["リーダーのタスク"]);
  });

  it("他のメンバーのメールアドレスは含まれない", async () => {
    const text = await (await get(url(), p.members[0]!.cookie)).text();
    expect(text).not.toContain("@example.com");
  });
});
