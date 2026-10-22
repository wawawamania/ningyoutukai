/**
 * テストが使う DB の決め方と、安全装置(tests/setup.ts が使う)。
 *
 * テストはデータを作って消すので、開発用の DB に対して走らせてはいけない。
 * 接続先は次の順で決め、**DB 名が `_test` で終わらなければ、テストの開始時に中止する**。
 *   1. `TEST_DATABASE_URL`(そのまま使う)
 *   2. `DATABASE_URL` の DB 名に `_test` を付けたもの(すでに `_test` で終わるならそのまま)
 */
export function dbNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export function resolveTestDatabaseUrl(env: Record<string, string | undefined>): string {
  const explicit = env.TEST_DATABASE_URL;
  let url = explicit;
  if (!url) {
    const base = env.DATABASE_URL;
    if (!base) {
      throw new Error(
        "テストの接続先がありません。api/.env.local に DATABASE_URL(または TEST_DATABASE_URL)を設定してください(api/.env.local.example を参照)。",
      );
    }
    const u = new URL(base);
    const name = dbNameOf(base);
    if (!name) throw new Error("DATABASE_URL に DB 名が含まれていません。");
    if (!name.endsWith("_test")) u.pathname = `/${encodeURIComponent(`${name}_test`)}`;
    url = u.toString();
  }
  const name = dbNameOf(url);
  if (!name.endsWith("_test")) {
    throw new Error(
      `テストを中止しました: 接続先の DB 名が "${name}" で、"_test" で終わっていません。` +
        "テストはデータを作って消すため、開発用の DB には実行できません。" +
        "TEST_DATABASE_URL をテスト用の DB(例: ningyoutukai_test)に向けてください。",
    );
  }
  return url;
}

/** パスワードを伏せた接続先(ログ・エラー表示用) */
export function redact(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = "***";
  return u.toString();
}
