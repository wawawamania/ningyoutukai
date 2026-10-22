import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DESCRIPTION_MAX } from "../../src/lib/task-input";
import { cleanup, findTask, insertTask, request, setupProduct } from "./helpers";

// タスク情報変更の入力検証(NUL 文字・説明の上限・期限の範囲)

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let taskId: string;

beforeAll(async () => {
  p = await setupProduct();
  const task = await insertTask(p.members[0]!.memberId, {
    taskName: "元の名前",
    description: "元の説明",
    timeLimit: new Date("2026-06-01T00:00:00Z"),
  });
  taskId = task.taskId;
});
afterAll(cleanup);

const patch = (body: Record<string, unknown>) =>
  request("PATCH", `/api/product/${p.productId}/task/${taskId}`, {
    cookie: p.leader.cookie,
    body,
  });

describe("NUL 文字", () => {
  it("taskName に NUL 文字を含むと 422 で、変更されない(500 にならない)", async () => {
    const res = await patch({ taskName: "a\u0000b" });
    expect(res.status).toBe(422);
    expect((await findTask(taskId))?.taskName).toBe("元の名前");
  });

  it("description に NUL 文字を含むと 422 で、変更されない(500 にならない)", async () => {
    const res = await patch({ description: "a\u0000b" });
    expect(res.status).toBe(422);
    expect((await findTask(taskId))?.description).toBe("元の説明");
  });

  it("エラー本文に SQL 文が含まれない", async () => {
    const res = await patch({ description: "a\u0000b" });
    expect(await res.text()).not.toContain("update \"tasks\"");
  });
});

describe("description の上限", () => {
  it(`${DESCRIPTION_MAX} 文字までは変更できる`, async () => {
    const description = "あ".repeat(DESCRIPTION_MAX);
    expect((await patch({ description })).status).toBe(200);
    expect((await findTask(taskId))?.description).toBe(description);
  });

  it(`${DESCRIPTION_MAX + 1} 文字は 422 で、変更されない`, async () => {
    const before = (await findTask(taskId))?.description;
    const res = await patch({ description: "あ".repeat(DESCRIPTION_MAX + 1) });
    expect(res.status).toBe(422);
    expect((await findTask(taskId))?.description).toBe(before);
  });

  it("null で説明を消せる", async () => {
    expect((await patch({ description: null })).status).toBe(200);
    expect((await findTask(taskId))?.description).toBeNull();
  });
});

describe("timeLimit の検証", () => {
  it("時刻とタイムゾーンつきの期限に変更できる", async () => {
    const res = await patch({ timeLimit: "2026-12-01T09:00:00+09:00" });
    expect(res.status).toBe(200);
    expect((await findTask(taskId))?.timeLimit?.toISOString()).toBe(
      "2026-12-01T00:00:00.000Z"
    );
  });

  it("null で期限を消せる", async () => {
    expect((await patch({ timeLimit: null })).status).toBe(200);
    expect((await findTask(taskId))?.timeLimit).toBeNull();
  });

  it("日付だけ・タイムゾーンなしは 422", async () => {
    expect((await patch({ timeLimit: "2026-12-01" })).status).toBe(422);
    expect((await patch({ timeLimit: "2026-12-01T09:00:00" })).status).toBe(422);
  });

  it("範囲(2000〜2100 年)の外・存在しない日付は 400 で、変更されない", async () => {
    await patch({ timeLimit: "2026-12-01T00:00:00Z" });
    const before = (await findTask(taskId))?.timeLimit?.toISOString();
    for (const timeLimit of [
      "0001-01-01T00:00:00Z",
      "2101-01-01T00:00:00Z",
      "9999-12-31T00:00:00Z",
      "2026-02-30T00:00:00Z",
    ]) {
      const res = await patch({ timeLimit });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain("期限");
    }
    expect((await findTask(taskId))?.timeLimit?.toISOString()).toBe(before);
  });

  it("不正な期限と正しい項目を同時に送ると、何も変更されない", async () => {
    const before = (await findTask(taskId))?.taskName;
    const res = await patch({ taskName: "新しい名前", timeLimit: "9999-12-31T00:00:00Z" });
    expect(res.status).toBe(400);
    expect((await findTask(taskId))?.taskName).toBe(before);
  });
});
