/**
 * GitHub でログイン済みなのに github_id が空の人に、GitHub のユーザー名(login)を入れる(一度きりの修復)。
 *
 * 使い方(api/ で実行):
 *   DATABASE_URL=postgres://... bun scripts/backfill-github-username.ts            # 既定: 一覧だけ表示(dry-run)
 *   DATABASE_URL=postgres://... bun scripts/backfill-github-username.ts --apply    # 実際に更新
 *
 * 仕組み: better-auth の account(provider_id = 'github')の account_id は、GitHub の数値 ID。
 * 公開 API `GET https://api.github.com/user/{id}` は、認証なしで login を返す(レート制限は 1 時間 60 回 / IP)。
 * その login を、better-auth の user.github_id と、アプリの users.github_id(メールで対応)に入れる。
 * 冪等: すでに login と同じなら何もしない。users.github_id は unique なので、別の人が使っていれば、その行は飛ばす。
 * 環境変数 GITHUB_API_BASE は、テスト用に API の向き先を変えるためのもの(既定 https://api.github.com)。
 */
import "dotenv/config";
import pg from "pg";

const apply = process.argv.includes("--apply");
const apiBase = process.env.GITHUB_API_BASE ?? "https://api.github.com";

const maskEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
};

type Target = {
  userId: string;
  email: string;
  accountId: string;
  authGithubId: string | null;
  appGithubId: string | null;
  appExists: boolean;
};

async function fetchLogin(accountId: string): Promise<{ login?: string; stop?: string; skip?: string }> {
  const res = await fetch(`${apiBase}/user/${encodeURIComponent(accountId)}`, {
    headers: { "User-Agent": "ningyoutukai-backfill", Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return { skip: "GitHub に該当のアカウントがない(削除済み?)" };
  if (res.status === 403 || res.status === 429) {
    return { stop: `GitHub API のレート制限(HTTP ${res.status})。しばらく待って、もう一度実行してください` };
  }
  if (!res.ok) return { skip: `GitHub API が HTTP ${res.status}` };
  const body = (await res.json()) as { login?: string };
  return body.login ? { login: body.login } : { skip: "login が取れない" };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL を環境変数で渡してください");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    console.log(apply ? "== 適用モード(--apply): 更新します ==" : "== dry-run(更新しません。--apply で更新) ==");
    const { rows } = await client.query<Target>(`
      SELECT u.id AS "userId", u.email, a.account_id AS "accountId",
             u.github_id AS "authGithubId", au.github_id AS "appGithubId", (au.user_id IS NOT NULL) AS "appExists"
      FROM account a
      JOIN "user" u ON u.id = a.user_id
      LEFT JOIN users au ON lower(au.email) = lower(u.email)
      WHERE a.provider_id = 'github'
        AND (u.github_id IS NULL OR (au.user_id IS NOT NULL AND au.github_id IS NULL))
      ORDER BY u.created_at
    `);
    console.log(`対象: ${rows.length} 人`);

    let updated = 0;
    for (const t of rows) {
      const r = await fetchLogin(t.accountId);
      if (r.stop) {
        console.error(r.stop);
        process.exitCode = 1;
        break;
      }
      if (!r.login) {
        console.log(`- ${maskEmail(t.email)} (github id ${t.accountId}): 飛ばす: ${r.skip}`);
        continue;
      }
      const login = r.login;
      console.log(
        `- ${maskEmail(t.email)} (github id ${t.accountId}): user.github_id ${t.authGithubId ?? "(空)"} -> ${login}` +
          (t.appExists ? `, users.github_id ${t.appGithubId ?? "(空)"} -> ${login}` : ", users に行なし(次のログインで作られる)"),
      );
      if (!apply) continue;
      await client.query(`UPDATE "user" SET github_id = $1 WHERE id = $2 AND github_id IS DISTINCT FROM $1`, [login, t.userId]);
      if (t.appExists) {
        try {
          await client.query(`UPDATE users SET github_id = $1 WHERE lower(email) = lower($2) AND github_id IS DISTINCT FROM $1`, [login, t.email]);
        } catch (e) {
          if ((e as { code?: string }).code !== "23505") throw e;
          console.warn(`  ! users.github_id ${login} は別のユーザーが使っているため、users は更新しませんでした`);
        }
      }
      updated++;
    }
    console.log(apply ? `更新: ${updated} 人` : "dry-run のため、何も更新していません");
  } finally {
    await client.end();
  }
}

await main();
