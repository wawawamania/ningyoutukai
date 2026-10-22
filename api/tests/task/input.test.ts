import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  DESCRIPTION_MAX,
  TASK_NAME_MAX,
  descriptionSchema,
  parseTimeLimit,
  taskNameSchema,
  timeLimitSchema,
} from "../../src/lib/task-input";

describe("タスク名・説明のスキーマ", () => {
  test("NUL 文字を含むと不正", () => {
    expect(Value.Check(taskNameSchema(), "a\u0000b")).toBe(false);
    expect(Value.Check(descriptionSchema(), "a\u0000b")).toBe(false);
  });

  test("改行・日本語・絵文字は許可される", () => {
    expect(Value.Check(descriptionSchema(), "1行目\n2行目 ✅")).toBe(true);
    expect(Value.Check(taskNameSchema(), "デザイン作成")).toBe(true);
  });

  test("文字数の上限", () => {
    expect(Value.Check(taskNameSchema(), "a".repeat(TASK_NAME_MAX))).toBe(true);
    expect(Value.Check(taskNameSchema(), "a".repeat(TASK_NAME_MAX + 1))).toBe(false);
    expect(Value.Check(descriptionSchema(), "a".repeat(DESCRIPTION_MAX))).toBe(true);
    expect(Value.Check(descriptionSchema(), "a".repeat(DESCRIPTION_MAX + 1))).toBe(false);
  });
});

describe("期限のスキーマ", () => {
  test("時刻とタイムゾーンつきの ISO 8601 は許可される", () => {
    for (const v of [
      "2026-12-01T09:00:00Z",
      "2026-12-01T09:00:00+09:00",
      "2026-12-01T09:00:00.123Z",
      "2026-12-01T09:00Z",
    ]) {
      expect(Value.Check(timeLimitSchema(), v)).toBe(true);
    }
  });

  test("日付だけ・タイムゾーンなし・日時でない文字列は不正", () => {
    for (const v of ["2026-12-01", "2026-12-01T09:00:00", "あした", "", "2026/12/01"]) {
      expect(Value.Check(timeLimitSchema(), v)).toBe(false);
    }
  });
});

describe("parseTimeLimit", () => {
  test("正しい期限は Date になる", () => {
    expect(parseTimeLimit("2026-12-01T09:00:00+09:00")?.toISOString()).toBe(
      "2026-12-01T00:00:00.000Z"
    );
  });

  test("範囲(2000〜2100 年)の外は null", () => {
    expect(parseTimeLimit("0001-01-01T00:00:00Z")).toBeNull();
    expect(parseTimeLimit("1999-12-31T23:59:59Z")).toBeNull();
    expect(parseTimeLimit("2101-01-01T00:00:00Z")).toBeNull();
    expect(parseTimeLimit("9999-12-31T00:00:00Z")).toBeNull();
  });

  test("範囲の境界は許可される", () => {
    expect(parseTimeLimit("2000-01-01T00:00:00Z")).not.toBeNull();
    expect(parseTimeLimit("2100-12-31T23:59:59Z")).not.toBeNull();
  });

  test("存在しない日付は null", () => {
    expect(parseTimeLimit("2026-02-30T00:00:00Z")).toBeNull();
    expect(parseTimeLimit("2026-13-01T00:00:00Z")).toBeNull();
  });
});
