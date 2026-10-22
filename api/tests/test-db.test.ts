import { expect, test } from "bun:test";
import { dbNameOf, redact, resolveTestDatabaseUrl } from "./test-db";

const base = "postgres://postgres:postgres@localhost:5434";

test("TEST_DATABASE_URL があればそれを使う", () => {
  expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: `${base}/foo_test`, DATABASE_URL: `${base}/dev` })).toBe(`${base}/foo_test`);
});

test("DATABASE_URL の DB 名に _test を付ける", () => {
  expect(dbNameOf(resolveTestDatabaseUrl({ DATABASE_URL: `${base}/ningyoutukai` }))).toBe("ningyoutukai_test");
});

test("DB 名が既に _test で終わるなら、そのまま", () => {
  expect(resolveTestDatabaseUrl({ DATABASE_URL: `${base}/ningyoutukai_test` })).toBe(`${base}/ningyoutukai_test`);
});

test("TEST_DATABASE_URL の DB 名が _test で終わらなければ中止する", () => {
  expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: `${base}/ningyoutukai` })).toThrow("_test");
});

test("接続先がどちらも無ければ、分かりやすいエラーにする", () => {
  expect(() => resolveTestDatabaseUrl({})).toThrow("DATABASE_URL");
});

test("redact はパスワードを伏せる", () => {
  expect(redact(`${base}/x_test`)).not.toContain("postgres:postgres");
  expect(redact(`${base}/x_test`)).toContain("***");
});
