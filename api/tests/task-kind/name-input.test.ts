import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { taskTypes } from "../../src/db/schema";
import { cleanup, request, setupProduct } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;

beforeAll(async () => {
  p = await setupProduct();
});
afterAll(cleanup);

const base = () => `/api/product/${p.productId}/task_kinds`;
const post = (body: unknown) => request("POST", base(), { cookie: p.leader.cookie, body });
const patch = (id: string, body: unknown) =>
  request("PATCH", `${base()}/${id}`, { cookie: p.leader.cookie, body });
const names = async () =>
  (await db.select().from(taskTypes).where(eq(taskTypes.productId, p.productId))).map(
    (k) => k.taskTypeName
  );
const seed = async (name: string) => {
  const [k] = await db
    .insert(taskTypes)
    .values({ productId: p.productId, taskTypeName: name })
    .returning();
  return k.taskTypeId;
};

describe("対になっていないサロゲート", () => {
  for (const [label, input] of [
    ["単独の上位サロゲート", "\ud800"],
    ["単独の下位サロゲート", "\udc00"],
    ["途中の下位サロゲート", "a\udc00b"],
    ["末尾の上位サロゲート", "a\ud800"],
  ] as const) {
    it(`追加: ${label}は 422 で保存されない`, async () => {
      const before = (await names()).length;
      expect((await post({ taskTypeName: input })).status).toBe(422);
      expect((await names()).length).toBe(before);
    });
    it(`編集: ${label}は 422 で名前が変わらない`, async () => {
      const orig = `sur-${crypto.randomUUID().slice(0, 8)}`;
      const id = await seed(orig);
      expect((await patch(id, { taskTypeName: input })).status).toBe(422);
      expect(await names()).toContain(orig);
    });
  }
  it("対になったサロゲート(絵文字)は保存できる", async () => {
    const res = await post({ taskTypeName: "😀テスト" });
    expect(res.status).toBe(201);
    expect((await res.json()).taskTypeName).toBe("😀テスト");
  });
});

describe("ゼロ幅の文字", () => {
  for (const [label, ch] of [
    ["U+200B", "​"],
    ["U+200C", "‌"],
    ["U+200D", "‍"],
    ["U+2060", "⁠"],
    ["U+180E", "᠎"],
    ["U+FEFF", "﻿"],
    ["U+0085", "\u0085"],
    ["空白とゼロ幅の混在", " ​ ‍ "],
  ] as const) {
    it(`追加: ${label}だけの名前は 400 で保存されない`, async () => {
      const before = (await names()).length;
      const res = await post({ taskTypeName: ch });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: "種類の名前を入力してください" });
      expect((await names()).length).toBe(before);
    });
    it(`編集: ${label}だけの名前は 400 で名前が変わらない`, async () => {
      const orig = `zw-${crypto.randomUUID().slice(0, 8)}`;
      const id = await seed(orig);
      const res = await patch(id, { taskTypeName: ch });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: "種類の名前を入力してください" });
      expect(await names()).toContain(orig);
    });
  }
  it("ZWJ を含む絵文字の名前は、そのまま保存できる(追加・編集)", async () => {
    const family = "👨‍👩‍👧";
    const res = await post({ taskTypeName: family });
    expect(res.status).toBe(201);
    expect((await res.json()).taskTypeName).toBe(family);
    const id = await seed(`fam-${crypto.randomUUID().slice(0, 8)}`);
    const res2 = await patch(id, { taskTypeName: `${family}家族` });
    expect(res2.status).toBe(200);
    expect((await res2.json()).taskTypeName).toBe(`${family}家族`);
    expect(await names()).toContain(`${family}家族`);
  });
});
