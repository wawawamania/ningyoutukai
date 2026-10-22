import "./lib/load-env";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/auth-schema";

export const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

type GithubProfileLite = {
  id: number | string;
  login: string;
};

/**
 * GitHub のユーザー名(login)の一時置き場。キーは GitHub の数値 ID(= account.accountId)。
 *
 * better-auth は、`mapProfileToUser` が返した項目のうち、`input: false` のもの(= `githubId`)を捨てる
 * (`parseAdditionalUserInputFromProviderProfile`)。そのため、戻り値で `githubId` を返しても保存されない。
 * `input: true` にすると、ログイン済みの人が `/update-user` で自分の `githubId` を好きな値にでき、
 * 他人の GitHub のユーザー名宛ての招待を受け取れてしまう。
 * そこで、`mapProfileToUser`(ログインのたびに呼ばれる)でユーザー名を控えておき、
 * その直後の account の作成・更新フック(`syncGithubLogin`)で、サーバー側から保存する。
 */
const pendingGithubLogins = new Map<string, { login: string; at: number }>();
const PENDING_TTL_MS = 60_000;

/** GitHub のプロフィールを受け取り、ユーザー名を控える。保存は `syncGithubLogin` が行う */
export function mapGithubProfile(profile: GithubProfileLite) {
  const now = Date.now();
  for (const [key, v] of pendingGithubLogins) {
    if (now - v.at > PENDING_TTL_MS) pendingGithubLogins.delete(key);
  }
  pendingGithubLogins.set(String(profile.id), { login: profile.login, at: now });
  return {};
}

/** GitHub の account の作成・更新(= GitHub でのログイン)のたびに、user.github_id を最新のユーザー名にする */
export async function syncGithubLogin(acct: {
  providerId: string;
  accountId: string;
  userId: string;
}) {
  if (acct.providerId !== "github") return;
  const pending = pendingGithubLogins.get(acct.accountId);
  if (!pending) return;
  pendingGithubLogins.delete(acct.accountId);
  await db.update(schema.user).set({ githubId: pending.login }).where(eq(schema.user.id, acct.userId));
}

// GitHub / Google は環境変数が揃っているものだけ有効にする
const socialProviders = {
  ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        // 追加: メール非公開の人でも email を取れるようにする
        scope: ["read:user", "user:email"],
        // ログインのたびに呼ばれる。ユーザー名を控え、account フックで保存する(username の変更にも追従する)
        mapProfileToUser: mapGithubProfile,
      },
      }
    : {}),
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
};

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [webOrigin],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // パスワード認証は提供しない(要件定義: DB にパスワードを持たない)
  emailAndPassword: { enabled: false },
  user: {
  // 追加: app-user.ts が users へコピーするために、better-auth の user に保存する
  additionalFields: {
    githubId: { type: "string", required: false, input: false },
  },
},
  databaseHooks: {
    account: {
      create: { after: syncGithubLogin },
      update: { after: syncGithubLogin },
    },
  },
  socialProviders,
  // 案 D(web と api が同じ親ドメインの別サブドメイン)のときだけ、cookie を親ドメインに付ける。
  // COOKIE_DOMAIN(例: `.example.com`)が未設定なら何も足さない(従来どおり。案 S の同一オリジンもこちら)
  ...(process.env.COOKIE_DOMAIN
    ? {
        advanced: {
          crossSubDomainCookies: {
            enabled: true,
            domain: process.env.COOKIE_DOMAIN,
          },
        },
      }
    : {}),
});
