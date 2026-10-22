import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, overrideWithEnvLocal } from "../src/lib/load-env";

// 本物の process.env には触れず、渡したオブジェクトに読み込む
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "load-env-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test(".env.local が .env より優先される", () => {
  writeFileSync(join(dir, ".env"), "A=from-env\nB=only-env\n");
  writeFileSync(join(dir, ".env.local"), "A=from-local\nC=only-local\n");
  const env: Record<string, string | undefined> = {};
  loadEnv(env, dir);
  expect(env).toEqual({ A: "from-local", B: "only-env", C: "only-local" });
});

test("シェルの環境変数が最優先(.env.local も .env も上書きしない)", () => {
  writeFileSync(join(dir, ".env"), "A=from-env\n");
  writeFileSync(join(dir, ".env.local"), "A=from-local\nB=from-local\n");
  const env: Record<string, string | undefined> = { A: "from-shell" };
  loadEnv(env, dir);
  expect(env.A).toBe("from-shell");
  expect(env.B).toBe("from-local");
});

test("シェルで空文字にした値も、ファイルで上書きされない", () => {
  writeFileSync(join(dir, ".env.local"), "A=from-local\n");
  const env: Record<string, string | undefined> = { A: "" };
  loadEnv(env, dir);
  expect(env.A).toBe("");
});

test(".env.local の空文字が勝つ(.env に RESEND_API_KEY があっても空のまま)", () => {
  writeFileSync(join(dir, ".env"), "RESEND_API_KEY=re_real_key\n");
  writeFileSync(join(dir, ".env.local"), "RESEND_API_KEY=\n");
  const env: Record<string, string | undefined> = {};
  loadEnv(env, dir);
  expect(env.RESEND_API_KEY).toBe("");
});

test("ファイルが無くてもエラーにしない", () => {
  const env: Record<string, string | undefined> = {};
  expect(() => loadEnv(env, dir)).not.toThrow();
  expect(env).toEqual({});
});

test("overrideWithEnvLocal: Bun が先に入れた .env の値を、.env.local で上書きする", () => {
  writeFileSync(join(dir, ".env.local"), "DATABASE_URL=local\nNEW=1\n");
  const env: Record<string, string | undefined> = { DATABASE_URL: "from-bun-env" };
  overrideWithEnvLocal(env, [], dir);
  expect(env).toEqual({ DATABASE_URL: "local", NEW: "1" });
});

test("overrideWithEnvLocal: 守る指定のキーは上書きしない", () => {
  writeFileSync(join(dir, ".env.local"), "TEST_DATABASE_URL=local\n");
  const env: Record<string, string | undefined> = { TEST_DATABASE_URL: "from-shell" };
  overrideWithEnvLocal(env, ["TEST_DATABASE_URL"], dir);
  expect(env.TEST_DATABASE_URL).toBe("from-shell");
});

test("overrideWithEnvLocal: .env.local が無ければ何もしない", () => {
  const env: Record<string, string | undefined> = { A: "1" };
  expect(() => overrideWithEnvLocal(env, [], dir)).not.toThrow();
  expect(env).toEqual({ A: "1" });
});

test(".env.local だけ、.env だけでも読める", () => {
  writeFileSync(join(dir, ".env"), "X=1\n");
  const a: Record<string, string | undefined> = {};
  loadEnv(a, dir);
  expect(a.X).toBe("1");
});
