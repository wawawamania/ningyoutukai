import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  TASK_KIND_NAME_MAX,
  isUniqueViolation,
  messageSchema,
  taskKindColumns,
  taskKindNameSchema,
  taskKindSchema,
} from "../../src/lib/task-kind";

describe("TASK_KIND_NAME_MAX", () => {
  it("50", () => {
    expect(TASK_KIND_NAME_MAX).toBe(50);
  });
});

describe("taskKindNameSchema", () => {
  const ok = (v: unknown) => Value.Check(taskKindNameSchema(), v);
  it("空文字・50 文字ちょうどは通る", () => {
    expect(ok("")).toBe(true);
    expect(ok("a".repeat(50))).toBe(true);
  });
  it("51 文字は通らない", () => {
    expect(ok("a".repeat(51))).toBe(false);
  });
  it("長さは UTF-16 のコード単位で数える(😀 × 25 は通り、× 26 は通らない)", () => {
    expect(ok("😀".repeat(25))).toBe(true);
    expect(ok("😀".repeat(26))).toBe(false);
  });
  it("NUL 文字を含むと通らない(先頭・途中・末尾)", () => {
    expect(ok("\u0000")).toBe(false);
    expect(ok("a\u0000")).toBe(false);
    expect(ok("a\u0000b")).toBe(false);
  });
  it("改行を含んでも通る(pattern は複数行で誤判定しない)", () => {
    expect(ok("a\nb")).toBe(true);
    expect(ok("a\n\u0000")).toBe(false);
    expect(ok("\u0000\nb")).toBe(false);
  });
  it("文字列以外は通らない", () => {
    for (const v of [1, null, undefined, [], {}, true]) expect(ok(v)).toBe(false);
  });
});

describe("taskKindSchema・messageSchema", () => {
  it("taskKindSchema は 3 項目の文字列を要求する", () => {
    const s = taskKindSchema();
    expect(Value.Check(s, { taskTypeId: "a", taskTypeName: "b", productId: "c" })).toBe(true);
    expect(Value.Check(s, { taskTypeId: "a", taskTypeName: "b" })).toBe(false);
    expect(Value.Check(s, { taskTypeId: "a", taskTypeName: null, productId: "c" })).toBe(false);
  });
  it("messageSchema は { message: string }", () => {
    expect(Value.Check(messageSchema(), { message: "x" })).toBe(true);
    expect(Value.Check(messageSchema(), {})).toBe(false);
  });
  it("taskKindColumns は 3 つの列だけ", () => {
    expect(Object.keys(taskKindColumns).sort()).toEqual(["productId", "taskTypeId", "taskTypeName"]);
  });
});

describe("isUniqueViolation", () => {
  it("code が 23505 なら true", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("cause.code が 23505 でも true(drizzle のラップされたエラー)", () => {
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error("x"), { cause: { code: "23505" } }))).toBe(true);
  });
  it("別のコード・null・undefined・文字列は false", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation({ cause: { code: "40001" } })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(new Error("duplicate"))).toBe(false);
  });
});
