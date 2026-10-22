import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { app } from "./app";

// 登録の追加・消失が意図的でないと失敗させるための、期待するルート一覧(メソッド + パス)
const EXPECTED_ROUTES = [
  "ALL /api/auth/*",
  "DELETE /api/product/:productId",
  "DELETE /api/product/:productId/member/:memberId",
  "DELETE /api/product/:productId/task/:taskId",
  "DELETE /api/product/:productId/task_kinds/:kindId",
  "GET /",
  "GET /api/invitation",
  "GET /api/product/",
  "GET /api/product/:productId",
  "GET /api/product/:productId/member",
  "GET /api/product/:productId/member/:memberId",
  "GET /api/product/:productId/member/:memberId/task",
  "GET /api/product/:productId/task",
  "GET /api/product/:productId/task/:taskId",
  "GET /api/product/:productId/task_kinds",
  "GET /api/product/:productId/tree",
  "GET /swagger",
  "GET /swagger/json",
  "OPTIONS /",
  "OPTIONS /*",
  "PATCH /api/product/:productId",
  "PATCH /api/product/:productId/task/:taskId",
  "PATCH /api/product/:productId/task/:taskId/complete",
  "PATCH /api/product/:productId/task/:taskId/task_kinds/:kindId",
  "PATCH /api/product/:productId/task_kinds/:kindId",
  "POST /api/invitation/:invitationId/accept",
  "POST /api/invitation/:invitationId/reject",
  "POST /api/product/",
  "POST /api/product/:productId/invitation",
  "POST /api/product/:productId/task",
  "POST /api/product/:productId/task/:taskId/complete-report",
  "POST /api/product/:productId/task_kinds",
];

const registered = app.routes.map((r) => `${r.method} ${r.path}`);

describe("app のルート登録", () => {
  test("登録済みルートが、期待する一覧と一致する", () => {
    expect([...registered].sort()).toEqual([...EXPECTED_ROUTES].sort());
  });

  test("同じメソッド + パスが、重複して登録されていない", () => {
    const duplicated = registered.filter((r, i) => registered.indexOf(r) !== i);
    expect(duplicated).toEqual([]);
  });

  test("routes/ の各プラグイン(xxxRoutes)が、app.ts で使われている", () => {
    const names: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
          const src = readFileSync(path, "utf8");
          for (const m of src.matchAll(/^export const (\w+Routes)\b/gm)) names.push(m[1]);
        }
      }
    };
    walk(join(import.meta.dir, "routes"));
    expect(names.length).toBeGreaterThan(0);

    const appSrc = readFileSync(join(import.meta.dir, "app.ts"), "utf8");
    const unused = names.filter((n) => !appSrc.includes(`.use(${n})`));
    expect(unused).toEqual([]);
  });
});
