/**
 * 全テストの前に、1 回だけ実行される(bunfig.toml の preload)。
 *
 * Bun は全テストファイルを 1 つのプロセスで実行し、読み込んだモジュールを使い回す。
 * そのため、`src/auth.ts`(better-auth)は、どのテストファイルが最初に読み込んだかで設定が決まり、
 * テストファイルの実行順によって結果が変わってしまう(外部認証のテストだけが落ちる、など)。
 * ここで環境変数を先にそろえて、どの順でも同じ `auth` になるようにする。
 */

import { overrideWithEnvLocal } from "../src/lib/load-env"; // .env.local / .env を先に読む(下の環境変数の調整は、その後に効く)
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/db";
import { dbNameOf, redact, resolveTestDatabaseUrl } from "./test-db";

// bun test は .env を先に環境変数へ入れる。.env.local を優先させる(シェルで明示したテスト用 DB の指定は守る)
overrideWithEnvLocal(process.env, ["TEST_DATABASE_URL"]);

// 外部認証のプロバイダを有効にする(実際の OAuth 通信はしない。認可 URL を作るだけ)
process.env.GITHUB_CLIENT_ID = "test-github-client-id";
process.env.GITHUB_CLIENT_SECRET = "test-github-client-secret";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.WEB_ORIGIN ??= "http://localhost:3000";

// better-auth は NODE_ENV=test(bun test の既定)だと、Origin / callbackURL の検証をスキップする。
// 本番と同じく検証が働く状態にするため、最初の読み込みの前に development にしておく。
// (better-auth は NODE_ENV を、最初に読み込んだときの 1 回しか見ない)
process.env.NODE_ENV = "development";

// .env に RESEND_API_KEY を入れても、テストが実際にメールを送らないようにする(mailer はキーが無いとログだけ出す)
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
delete process.env.MAILPIT_URL; // 同様に、ローカルの受信箱(Mailpit)にも送らない

// ---- テスト用 DB への切り替えと、マイグレーション(R2) ----
// DATABASE_URL が環境にあっても、.env.local から読まれても、テストは必ずテスト用 DB(`_test` で終わる)を使う。
// 終わらなければ、ここで中止する(開発用の DB にテストが走るのを防ぐ)。
// preload で例外を投げると、テストファイルごとに同じエラーが繰り返されるので、1 回だけ表示して終了する。
function abort(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

let testUrl: string;
try {
  testUrl = resolveTestDatabaseUrl(process.env);
} catch (e) {
  abort((e as Error).message);
}
// src/db の `db` と、テスト内の process.env.DATABASE_URL の参照が、テスト用 DB を向くようにする
process.env.DATABASE_URL = testUrl;

// マイグレーションを自動で適用する(drizzle-kit に頼らないので、`bun test` を直接実行しても適用される。
// 適用済みのものは飛ばされる)。テスト用 DB が無い・DB に届かないときは、分かりやすいエラーで止める。
const migrationDb = createDb(testUrl);
try {
  await migrate(migrationDb, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
} catch (e) {
  const err = e as { code?: string; cause?: { code?: string } };
  const code = err.code ?? err.cause?.code;
  const name = dbNameOf(testUrl);
  const where = `${redact(testUrl)}(DB: ${name})`;
  if (code === "3D000") {
    abort(
      `テスト用 DB が存在しません: ${where}\n` +
        "dev 用コンテナを新しく起動すると自動で作られます: (api ディレクトリで) docker compose up -d --wait\n" +
        `起動済みのコンテナに作るなら: docker exec ningyoutukai-dev-db createdb -U postgres ${name}`,
    );
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    abort(`DB に接続できません: ${where}\ndev 用コンテナを起動してください: (api ディレクトリで) docker compose up -d --wait`);
  }
  abort(`テスト用 DB へのマイグレーションに失敗しました: ${where}\n${e instanceof Error ? e.message : String(e)}`);
} finally {
  await migrationDb.$client.end();
}
