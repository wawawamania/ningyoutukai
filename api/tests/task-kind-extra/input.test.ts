import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cleanup, kindNames, post, rawPost, setupProduct } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;

beforeAll(async () => {
  p = await setupProduct();
});
afterAll(cleanup);

const create = (body: unknown) => post(p.productId, p.leader.cookie, body);

describe("名前の長さの境界", () => {
  it("50 文字ちょうどは 201、51 文字は 422", async () => {
    expect((await create({ taskTypeName: "a".repeat(50) })).status).toBe(201);
    const res = await create({ taskTypeName: "a".repeat(51) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ message: "入力が正しくありません: taskTypeName" });
  });
  it("日本語 50 文字は 201、51 文字は 422", async () => {
    expect((await create({ taskTypeName: "あ".repeat(50) })).status).toBe(201);
    expect((await create({ taskTypeName: "あ".repeat(51) })).status).toBe(422);
  });
  it("サロゲートペア: 😀 × 25(UTF-16 で 50)は 201、× 26(52)は 422", async () => {
    expect((await create({ taskTypeName: "😀".repeat(25) })).status).toBe(201);
    expect((await create({ taskTypeName: "😀".repeat(26) })).status).toBe(422);
  });
  it("前後の空白を含めて 51 文字以上は、トリム後が短くても 422(検証がトリムより先)", async () => {
    expect((await create({ taskTypeName: ` ${"b".repeat(50)}` })).status).toBe(422);
  });
  it("前後の空白を含めて 50 文字以内なら、トリムして保存される", async () => {
    const res = await create({ taskTypeName: ` ${"c".repeat(48)} ` });
    expect(res.status).toBe(201);
    expect((await res.json()).taskTypeName).toBe("c".repeat(48));
  });
});

describe("空白だけ・空の名前は 400", () => {
  const blanks: [string, string][] = [
    ["空文字", ""],
    ["半角スペース", "   "],
    ["全角スペース", "　　"],
    ["タブ・改行", "\t\n\r"],
    ["nbsp", " "],
  ];
  for (const [label, name] of blanks) {
    it(label, async () => {
      const res = await create({ taskTypeName: name });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: "種類の名前を入力してください" });
    });
  }
});

describe("特殊な文字", () => {
  it("改行を含む名前もそのまま保存される", async () => {
    const res = await create({ taskTypeName: "行1\n行2" });
    expect(res.status).toBe(201);
    expect((await res.json()).taskTypeName).toBe("行1\n行2");
  });
  it("NUL 文字は先頭・末尾・途中のどれでも 422 で、500 にならない", async () => {
    for (const name of ["\u0000", "\u0000a", "a\u0000", "a\u0000b"]) {
      const res = await create({ taskTypeName: name });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ message: "入力が正しくありません: taskTypeName" });
    }
  });
  it("SQL 風・HTML 風の文字列は、そのまま文字列として保存される", async () => {
    for (const name of ["'; DROP TABLE task_types; --", "<script>alert(1)</script>", "%_\\"]) {
      const res = await create({ taskTypeName: name });
      expect(res.status).toBe(201);
      expect((await res.json()).taskTypeName).toBe(name);
    }
    expect(await kindNames(p.productId)).toContain("'; DROP TABLE task_types; --");
  });
  it("結合文字(が + 濁点)も保存できる", async () => {
    expect((await create({ taskTypeName: "が" })).status).toBe(201);
  });
});

describe("型・形式の違い", () => {
  const bad: [string, unknown][] = [
    ["数値", { taskTypeName: 123 }],
    ["配列", { taskTypeName: ["a"] }],
    ["null", { taskTypeName: null }],
    ["オブジェクト", { taskTypeName: { a: 1 } }],
    ["真偽値", { taskTypeName: true }],
    ["フィールドなし", {}],
    ["別名のフィールド", { name: "x" }],
  ];
  for (const [label, body] of bad) {
    it(`${label}は 422 で { message } の形`, async () => {
      const res = await create(body);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(Object.keys(json)).toEqual(["message"]);
      expect(json.message).toStartWith("入力が正しくありません");
    });
  }
  it("本文が配列・文字列・null でも 422", async () => {
    for (const body of [[], "x", null]) {
      const res = await rawPost(p.productId, p.leader.cookie, JSON.stringify(body), "application/json");
      expect(res.status).toBe(422);
    }
  });
  it("余計なフィールドは無視され、応答に漏れない", async () => {
    const res = await create({ taskTypeName: "extra-field", productId: crypto.randomUUID(), taskTypeId: crypto.randomUUID() });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["productId", "taskTypeId", "taskTypeName"]);
    expect(json.productId).toBe(p.productId);
  });
  it("本文なしは 422 か 400(500 にならない)", async () => {
    const res = await rawPost(p.productId, p.leader.cookie, "", "application/json");
    expect([400, 422]).toContain(res.status);
    expect(typeof (await res.json()).message).toBe("string");
  });
  it("不正な JSON は 400 で { message }", async () => {
    const res = await rawPost(p.productId, p.leader.cookie, "{not json", "application/json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "リクエストの形式が正しくありません" });
  });
  it("Content-Type が text/plain でも 500 にならず { message } を返す", async () => {
    const res = await rawPost(p.productId, p.leader.cookie, '{"taskTypeName":"ct"}', "text/plain");
    expect(res.status).toBeLessThan(500);
    expect(typeof (await res.json()).message).toBe("string");
  });
  it("Content-Type なしでも 500 にならない", async () => {
    const res = await rawPost(p.productId, p.leader.cookie, '{"taskTypeName":"ct2"}');
    expect(res.status).toBeLessThan(500);
  });
});

describe("プロダクト ID の形式", () => {
  it("UUID でない productId は 422", async () => {
    const res = await post("not-a-uuid", p.leader.cookie, { taskTypeName: "x" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ message: "入力が正しくありません: productId" });
  });
  it("存在しない productId は 404", async () => {
    const res = await post(crypto.randomUUID(), p.leader.cookie, { taskTypeName: "x" });
    expect(res.status).toBe(404);
  });
});
