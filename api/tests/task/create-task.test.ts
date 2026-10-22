import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mailer } from "../../src/lib/mailer";
import {
  cleanup,
  countTasks,
  createOutsider,
  createTaskType,
  findTask,
  request,
  setupProduct,
} from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let other: Ctx;
const sendSpy = spyOn(mailer, "send");

beforeAll(async () => {
  p = await setupProduct();
  other = await setupProduct();
  sendSpy.mockResolvedValue({ ok: true });
});
afterEach(() => sendSpy.mockClear());
afterAll(async () => {
  sendSpy.mockRestore();
  await cleanup();
});

const url = (productId = p.productId) => `/api/product/${productId}/task`;
const post = (body: unknown, cookie = p.leader.cookie, productId = p.productId) =>
  request("POST", url(productId), { cookie, body });
const valid = () => ({ taskName: "タスクA", productMemberId: p.members[0]!.memberId });

describe("認証・権限", () => {
  it("cookie なしは 401", async () => {
    expect((await request("POST", url(), { body: valid() })).status).toBe(401);
  });
  it("所属していないユーザーは 404", async () => {
    const o = await createOutsider();
    const res = await post(valid(), o.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });
  it("存在しないプロダクトは 404", async () => {
    expect((await post(valid(), p.leader.cookie, crypto.randomUUID())).status).toBe(404);
  });
  it("メンバーは 403 で何も作られない", async () => {
    const before = await countTasks(p.productId);
    const res = await post(valid(), p.members[0]!.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
    expect(await countTasks(p.productId)).toBe(before);
  });
});

describe("正常系", () => {
  it("201 とタスクの形を返し、DB に保存される", async () => {
    const type = await createTaskType(p.productId);
    const timeLimit = "2030-01-02T03:04:05.000Z";
    const res = await post({
      ...valid(),
      description: "説明",
      timeLimit,
      taskTypeId: type.taskTypeId,
      isVisible: false,
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(
      [
        "taskId", "taskName", "description", "timeLimit", "reportedAt",
        "completedAt", "taskTypeId", "productMemberId", "isVisible",
      ].sort()
    );
    expect(json).toMatchObject({
      taskName: "タスクA",
      description: "説明",
      timeLimit,
      reportedAt: null,
      completedAt: null,
      taskTypeId: type.taskTypeId,
      productMemberId: p.members[0]!.memberId,
      isVisible: false,
    });
    const row = await findTask(json.taskId);
    expect(row?.productMemberId).toBe(p.members[0]!.memberId);
    expect(row?.description).toBe("説明");
    expect(row?.timeLimit?.toISOString()).toBe(timeLimit);
    expect(row?.taskTypeId).toBe(type.taskTypeId);
    expect(row?.isVisible).toBe(false);
  });
  it("isVisible の既定は true", async () => {
    const json = await (await post(valid())).json();
    expect(json.isVisible).toBe(true);
    expect(json.description).toBeNull();
    expect(json.timeLimit).toBeNull();
    expect(json.taskTypeId).toBeNull();
    expect((await findTask(json.taskId))?.isVisible).toBe(true);
  });
  it("リーダー自身を担当にできる", async () => {
    const res = await post({ taskName: "自分用", productMemberId: p.leader.memberId });
    expect(res.status).toBe(201);
    expect((await res.json()).productMemberId).toBe(p.leader.memberId);
  });
});

describe("入力検証", () => {
  it("taskName 欠落は 422", async () => {
    expect((await post({ productMemberId: p.members[0]!.memberId })).status).toBe(422);
  });
  it("空白のみは 400", async () => {
    const before = await countTasks(p.productId);
    expect((await post({ ...valid(), taskName: "   " })).status).toBe(400);
    expect(await countTasks(p.productId)).toBe(before);
  });
  it("前後の空白は除去される", async () => {
    const json = await (await post({ ...valid(), taskName: "  名前  " })).json();
    expect(json.taskName).toBe("名前");
    expect((await findTask(json.taskId))?.taskName).toBe("名前");
  });
  it("201 文字は 422、200 文字は 201", async () => {
    expect((await post({ ...valid(), taskName: "あ".repeat(201) })).status).toBe(422);
    expect((await post({ ...valid(), taskName: "あ".repeat(200) })).status).toBe(201);
  });
  it("productMemberId 欠落は 422", async () => {
    expect((await post({ taskName: "x" })).status).toBe(422);
  });
  it("別プロダクトのメンバーを担当にすると 400 で何も作られない", async () => {
    const before = await countTasks(p.productId);
    const beforeOther = await countTasks(other.productId);
    const res = await post({ taskName: "x", productMemberId: other.members[0]!.memberId });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "担当者はプロダクトのメンバーを指定してください",
    });
    expect(await countTasks(p.productId)).toBe(before);
    expect(await countTasks(other.productId)).toBe(beforeOther);
  });
  it("存在しない taskTypeId は 400", async () => {
    const res = await post({ ...valid(), taskTypeId: crypto.randomUUID() });
    expect(res.status).toBe(400);
  });
  it("別プロダクトの taskTypeId は 400", async () => {
    const type = await createTaskType(other.productId);
    const before = await countTasks(p.productId);
    expect((await post({ ...valid(), taskTypeId: type.taskTypeId })).status).toBe(400);
    expect(await countTasks(p.productId)).toBe(before);
  });
  it("timeLimit が日時でない文字列は 422", async () => {
    expect((await post({ ...valid(), timeLimit: "あした" })).status).toBe(422);
  });
  it("productId が uuid でないと 422", async () => {
    expect((await post(valid(), p.leader.cookie, "not-a-uuid")).status).toBe(422);
  });
});

describe("メール通知", () => {
  it("作成すると担当者宛に 1 回送られる", async () => {
    const res = await post({ ...valid(), taskName: "通知テスト" });
    expect(res.status).toBe(201);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const mail = sendSpy.mock.calls[0]![0];
    expect(mail.to).toBe(p.members[0]!.email);
    expect(mail.subject).toBe("タスクが割り振られました: 通知テスト");
  });
  it("メール送信が失敗してもタスクは作成される", async () => {
    sendSpy.mockResolvedValueOnce({ ok: false, error: "boom" });
    expect((await post(valid())).status).toBe(201);
  });
  it("失敗(400 / 403)のときは送られない", async () => {
    await post({ ...valid(), taskName: " " });
    await post({ taskName: "x", productMemberId: other.members[0]!.memberId });
    await post(valid(), p.members[0]!.cookie);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
