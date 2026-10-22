import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mailer } from "../../src/lib/mailer";
import { DESCRIPTION_MAX } from "../../src/lib/task-input";
import { cleanup, countTasks, findTask, request, setupProduct } from "./helpers";

// タスク追加の入力検証(NUL 文字・説明の上限・期限の範囲)

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
const sendSpy = spyOn(mailer, "send");

beforeAll(async () => {
  p = await setupProduct();
  sendSpy.mockResolvedValue({ ok: true });
});
afterEach(() => sendSpy.mockClear());
afterAll(async () => {
  sendSpy.mockRestore();
  await cleanup();
});

const post = (body: Record<string, unknown>) =>
  request("POST", `/api/product/${p.productId}/task`, {
    cookie: p.leader.cookie,
    body: { taskName: "タスクA", productMemberId: p.members[0]!.memberId, ...body },
  });

describe("NUL 文字", () => {
  it("taskName に NUL 文字を含むと 422 で、タスクは作られない(500 にならない)", async () => {
    const res = await post({ taskName: "a\u0000b" });
    expect(res.status).toBe(422);
    expect(await countTasks(p.productId)).toBe(0);
  });

  it("description に NUL 文字を含むと 422 で、タスクは作られない(500 にならない)", async () => {
    const res = await post({ description: "a\u0000b" });
    expect(res.status).toBe(422);
    expect(await countTasks(p.productId)).toBe(0);
  });

  it("エラー本文に SQL 文が含まれない", async () => {
    const res = await post({ description: "a\u0000b" });
    expect(await res.text()).not.toContain("insert into");
  });
});

describe("description の上限", () => {
  it(`${DESCRIPTION_MAX} 文字までは作れる`, async () => {
    const description = "あ".repeat(DESCRIPTION_MAX);
    const res = await post({ description });
    expect(res.status).toBe(201);
    const task = await res.json();
    expect((await findTask(task.taskId))?.description).toBe(description);
  });

  it(`${DESCRIPTION_MAX + 1} 文字は 422`, async () => {
    const before = await countTasks(p.productId);
    const res = await post({ description: "あ".repeat(DESCRIPTION_MAX + 1) });
    expect(res.status).toBe(422);
    expect(await countTasks(p.productId)).toBe(before);
  });

  it("改行を含む説明は作れる", async () => {
    const res = await post({ description: "1行目\n2行目" });
    expect(res.status).toBe(201);
  });
});

describe("timeLimit の検証", () => {
  it("時刻とタイムゾーンつきの期限は作れ、正しい時刻で保存される", async () => {
    const res = await post({ timeLimit: "2026-12-01T09:00:00+09:00" });
    expect(res.status).toBe(201);
    const task = await res.json();
    expect(new Date(task.timeLimit).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("閏日(2024-02-29)は作れる", async () => {
    expect((await post({ timeLimit: "2024-02-29T00:00:00Z" })).status).toBe(201);
  });

  it("日付だけ・タイムゾーンなしは 422", async () => {
    expect((await post({ timeLimit: "2026-12-01" })).status).toBe(422);
    expect((await post({ timeLimit: "2026-12-01T09:00:00" })).status).toBe(422);
  });

  it("範囲(2000〜2100 年)の外は 400 で、タスクは作られない", async () => {
    const before = await countTasks(p.productId);
    for (const timeLimit of [
      "0001-01-01T00:00:00Z",
      "1999-12-31T23:59:59Z",
      "2101-01-01T00:00:00Z",
      "9999-12-31T00:00:00Z",
    ]) {
      const res = await post({ timeLimit });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain("期限");
    }
    expect(await countTasks(p.productId)).toBe(before);
  });

  it("存在しない日付(2 月 30 日、閏年でない年の 2 月 29 日)は 400", async () => {
    expect((await post({ timeLimit: "2026-02-30T00:00:00Z" })).status).toBe(400);
    expect((await post({ timeLimit: "2026-02-29T00:00:00Z" })).status).toBe(400);
  });

  it("検証に失敗したときは、通知メールを送らない", async () => {
    await post({ timeLimit: "9999-12-31T00:00:00Z" });
    await post({ description: "a\u0000b" });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
