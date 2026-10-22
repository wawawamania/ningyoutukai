import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { taskTypes, tasks } from "../../src/db/schema";
import {
  cleanup,
  del,
  findTask,
  insertTask,
  kindName,
  makeKind,
  patch,
  post,
  setupProduct,
} from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let other: Ctx;

beforeAll(async () => {
  p = await setupProduct();
  other = await setupProduct();
});
afterAll(cleanup);

const uniq = (s: string) => `${s}-${crypto.randomUUID().slice(0, 8)}`;
const rename = (kindId: string, name: unknown, c: Ctx = p) =>
  patch(c.productId, kindId, c.leader.cookie, { taskTypeName: name });
const exists = async (id: string) =>
  (await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, id))).length === 1;

describe("編集の追加観点", () => {
  it("前後の空白だけを変える(トリム後に自分自身と同名)は 200", async () => {
    const name = uniq("self");
    const id = await makeKind(p.productId, name);
    const res = await rename(id, `  ${name}  `);
    expect(res.status).toBe(200);
    expect((await res.json()).taskTypeName).toBe(name);
    expect(await kindName(id)).toBe(name);
  });
  it("大文字・小文字だけを変えるのは 200(同名とは扱わない)", async () => {
    const id = await makeKind(p.productId, uniq("case"));
    const upper = (await kindName(id))!.toUpperCase();
    expect((await rename(id, upper)).status).toBe(200);
    expect(await kindName(id)).toBe(upper);
  });
  it("前後の空白だけが違う別の種類の名前への変更は 409", async () => {
    const a = uniq("a");
    await makeKind(p.productId, a);
    const b = await makeKind(p.productId, uniq("b"));
    const res = await rename(b, ` ${a} `);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "同じ名前のタスクの種類がすでにあります" });
  });
  it("応答は { taskTypeId, taskTypeName, productId } だけ", async () => {
    const id = await makeKind(p.productId, uniq("shape"));
    const res = await rename(id, uniq("shape2"));
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["productId", "taskTypeId", "taskTypeName"]);
    expect(json.taskTypeId).toBe(id);
    expect(json.productId).toBe(p.productId);
  });
  it("型の違う・NUL・長すぎる名前は 422 で、名前は変わらない", async () => {
    const name = uniq("keep");
    const id = await makeKind(p.productId, name);
    for (const v of [123, null, ["x"], "a\u0000", "z".repeat(51), undefined]) {
      expect((await rename(id, v)).status).toBe(422);
    }
    expect(await kindName(id)).toBe(name);
  });
  it("50 文字ちょうどへの変更は 200、サロゲートペア 26 個は 422", async () => {
    const id = await makeKind(p.productId, uniq("len"));
    expect((await rename(id, "k".repeat(50))).status).toBe(200);
    expect((await rename(id, "😀".repeat(26))).status).toBe(422);
  });
  it("削除済みの種類への PATCH は 404", async () => {
    const id = await makeKind(p.productId, uniq("gone"));
    expect((await del(p.productId, id, p.leader.cookie)).status).toBe(204);
    const res = await rename(id, "復活");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "タスクの種類が見つかりません" });
  });
  it("別のプロダクトの ID で、別のプロダクトの種類を PATCH(URL のプロダクトと種類の不一致)は 404", async () => {
    const mine = await makeKind(p.productId, uniq("mine"));
    // other のリーダーは other に所属するが、mine は p の種類
    const res = await rename(mine, "奪う", other);
    expect(res.status).toBe(404);
    expect(await kindName(mine)).not.toBe("奪う");
  });
  it("p のリーダーが、other のプロダクトの URL を使うと 404(所属外)", async () => {
    const theirs = await makeKind(other.productId, uniq("theirs"));
    const res = await patch(other.productId, theirs, p.leader.cookie, { taskTypeName: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });
  it("変更しても、その種類を使うタスクの task_type_id は変わらない", async () => {
    const id = await makeKind(p.productId, uniq("used"));
    const t = await insertTask(p.members[0]!.memberId, { taskTypeId: id });
    expect((await rename(id, uniq("renamed"))).status).toBe(200);
    expect((await findTask(t.taskId))?.taskTypeId).toBe(id);
  });
});

describe("削除の追加観点", () => {
  it("完了済みのタスクの種類も null になり、タスクは残る", async () => {
    const id = await makeKind(p.productId, uniq("done"));
    const t = await insertTask(p.members[0]!.memberId, {
      taskTypeId: id,
      reportedAt: new Date(),
      completedAt: new Date(),
    });
    expect((await del(p.productId, id, p.leader.cookie)).status).toBe(204);
    const after = await findTask(t.taskId);
    expect(after?.taskTypeId).toBeNull();
    expect(after?.completedAt).not.toBeNull();
    expect(after?.reportedAt).not.toBeNull();
  });
  it("非表示のタスクの種類も null になる", async () => {
    const id = await makeKind(p.productId, uniq("hidden"));
    const t = await insertTask(p.members[0]!.memberId, { taskTypeId: id, isVisible: false });
    expect((await del(p.productId, id, p.leader.cookie)).status).toBe(204);
    expect((await findTask(t.taskId))?.taskTypeId).toBeNull();
    expect((await findTask(t.taskId))?.isVisible).toBe(false);
  });
  it("同じ種類を使う 20 件のタスクがすべて残り、種類だけ外れる", async () => {
    const id = await makeKind(p.productId, uniq("many"));
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push((await insertTask(p.members[i % 2]!.memberId, { taskTypeId: id, taskName: `t${i}` })).taskId);
    }
    expect((await del(p.productId, id, p.leader.cookie)).status).toBe(204);
    for (const tid of ids) {
      const t = await findTask(tid);
      expect(t).toBeDefined();
      expect(t?.taskTypeId).toBeNull();
    }
  });
  it("別のプロダクトの URL で p の種類を削除しようとしても、消えない(404)", async () => {
    const mine = await makeKind(p.productId, uniq("mine"));
    const res = await del(other.productId, mine, other.leader.cookie);
    expect(res.status).toBe(404);
    expect(await exists(mine)).toBe(true);
  });
  it("削除と同時にタスクへ種類を割り当てても、孤児(存在しない種類を指すタスク)は残らない", async () => {
    // タスクへの種類の割り当て API はこのブランチに無いので、DB へ直接 insert する
    for (let i = 0; i < 5; i++) {
      const id = await makeKind(p.productId, uniq("race"));
      const results = await Promise.allSettled([
        del(p.productId, id, p.leader.cookie),
        insertTask(p.members[0]!.memberId, { taskTypeId: id, taskName: `race${i}` }),
      ]);
      const delRes = results[0]!;
      expect(delRes.status).toBe("fulfilled");
      // 割り当て側は外部キー違反で失敗してもよい。成功した場合は null になっている
      const ins = results[1]!;
      if (ins.status === "fulfilled") {
        expect((await findTask(ins.value.taskId))?.taskTypeId).toBeNull();
      }
      expect(await exists(id)).toBe(false);
    }
    const orphans = await db
      .select({ taskId: tasks.taskId, taskTypeId: tasks.taskTypeId })
      .from(tasks)
      .where(eq(tasks.productMemberId, p.members[0]!.memberId));
    for (const o of orphans) {
      if (o.taskTypeId !== null) expect(await exists(o.taskTypeId)).toBe(true);
    }
  });
  it("同じ種類を同時に 2 回削除すると、204 が 1 つ・404 が 1 つで、500 は出ない", async () => {
    const id = await makeKind(p.productId, uniq("dd"));
    const results = await Promise.all([
      del(p.productId, id, p.leader.cookie),
      del(p.productId, id, p.leader.cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
  });
  it("削除した種類と同じ名前は、すぐに作り直せる", async () => {
    const name = uniq("again");
    const id = await makeKind(p.productId, name);
    await del(p.productId, id, p.leader.cookie);
    const res = await post(p.productId, p.leader.cookie, { taskTypeName: name });
    expect(res.status).toBe(201);
    expect((await res.json()).taskTypeId).not.toBe(id);
  });
  it("204 の本文は空", async () => {
    const id = await makeKind(p.productId, uniq("empty"));
    const res = await del(p.productId, id, p.leader.cookie);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});
