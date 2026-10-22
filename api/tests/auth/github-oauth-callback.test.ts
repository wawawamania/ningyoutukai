import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { auth } from "../../src/auth";
import { db } from "../../src/db";
import { account, user } from "../../src/db/auth-schema";
import { users } from "../../src/db/schema";
import { getOrCreateAppUser } from "../../src/lib/app-user";

/**
 * 実際の OAuth コールバック(GET /api/auth/callback/github)の流れで、
 * GitHub のユーザー名(login)が、better-auth の user.github_id と、アプリの users.github_id に入ることを確かめる。
 * GitHub への通信(トークン交換・プロフィール・メール)は、globalThis.fetch のスタブで差し替える(外部には接続しない)。
 * `mapGithubProfile` を直接呼ぶだけのテストでは、better-auth が戻り値を捨てる不具合に気づけなかった。
 */

const baseURL = process.env.BETTER_AUTH_URL!;
const webOrigin = process.env.WEB_ORIGIN!;
const realFetch = globalThis.fetch;
const uid = () => crypto.randomUUID().slice(0, 8);

type GithubFake = { numericId: number; login: string; email: string };

const emails = new Set<string>();

function stubExternal(fake: { github?: GithubFake }) {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(baseURL) || url.startsWith("http://localhost")) return realFetch(input, init);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    const g = fake.github;
    if (g && url === "https://github.com/login/oauth/access_token") {
      return json({ access_token: "gho_fake", token_type: "bearer", scope: "read:user,user:email" });
    }
    if (g && url === "https://api.github.com/user") {
      return json({
        id: g.numericId,
        login: g.login,
        name: `Name ${g.login}`,
        email: g.email,
        avatar_url: "https://example.invalid/a.png",
      });
    }
    if (g && url === "https://api.github.com/user/emails") {
      return json([{ email: g.email, primary: true, verified: true }]);
    }
    throw new Error(`テスト中に、想定外の外部通信: ${url}`);
  }) as typeof fetch;
}

beforeEach(() => stubExternal({}));
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  if (emails.size > 0) {
    await db.delete(users).where(inArray(users.email, [...emails]));
    await db.delete(user).where(inArray(user.email, [...emails]));
  }
});

const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** sign-in/social で state と cookie を得て、callback を呼ぶ(ログインの流れそのまま) */
async function loginWithGithub(fake: GithubFake) {
  emails.add(fake.email);
  stubExternal({ github: fake });
  const start = await auth.handler(
    new Request(`${baseURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webOrigin },
      body: JSON.stringify({ provider: "github", callbackURL: `${webOrigin}/` }),
    }),
  );
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  const res = await auth.handler(
    new Request(`${baseURL}/api/auth/callback/github?code=fake-code&state=${state}`, {
      headers: { cookie: cookiesOf(start), origin: webOrigin },
    }),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`${webOrigin}/`);
  const session = await auth.api.getSession({ headers: new Headers({ cookie: cookiesOf(res) }) });
  return session!;
}

const authRow = async (email: string) =>
  (await db.select().from(user).where(eq(user.email, email)))[0];
const appRow = async (email: string) =>
  (await db.select().from(users).where(eq(users.email, email)))[0];

describe("GitHub ログインのコールバック(外部通信はスタブ)", () => {
  test("新規ユーザー: user.github_id と users.github_id に login が入る", async () => {
    const login = `octo-${uid()}`;
    const email = `cb-${crypto.randomUUID()}@example.com`;
    const session = await loginWithGithub({ numericId: 1001, login, email });
    expect((await authRow(email)).githubId).toBe(login);
    await getOrCreateAppUser(session.user);
    expect((await appRow(email)).githubId).toBe(login);
  });

  test("すでにあるユーザー(github_id が空)の再ログイン: 空だった github_id が埋まる", async () => {
    const login = `octo-${uid()}`;
    const email = `cb-${crypto.randomUUID()}@example.com`;
    await loginWithGithub({ numericId: 1002, login, email });
    // 不具合の時期に作られたユーザーを再現: github_id を空にしておく
    await db.update(user).set({ githubId: null }).where(eq(user.email, email));
    await loginWithGithub({ numericId: 1002, login, email });
    expect((await authRow(email)).githubId).toBe(login);
  });

  test("GitHub のユーザー名を変えた人: 次のログインで追従する", async () => {
    const email = `cb-${crypto.randomUUID()}@example.com`;
    const before = `old-${uid()}`;
    const after = `new-${uid()}`;
    await loginWithGithub({ numericId: 1003, login: before, email });
    const session = await loginWithGithub({ numericId: 1003, login: after, email });
    expect((await authRow(email)).githubId).toBe(after);
    await getOrCreateAppUser(session.user);
    expect((await appRow(email)).githubId).toBe(after);
  });

  test("Google で先に作られたユーザーに GitHub が紐づく: github_id が入る", async () => {
    const login = `octo-${uid()}`;
    const email = `cb-${crypto.randomUUID()}@example.com`;
    emails.add(email);
    // Google でログイン済みのユーザー(メール確認済み)を、直接作る
    const { internalAdapter } = await auth.$context;
    const created = await internalAdapter.createUser({
      name: "Google User",
      email,
      emailVerified: true,
    }, { method: "admin" } as never);
    await internalAdapter.createAccount({
      userId: created.id,
      providerId: "google",
      accountId: `g-${uid()}`,
    });
    const session = await loginWithGithub({ numericId: 1004, login, email });
    expect(session.user.id).toBe(created.id);
    const accounts = await db.select().from(account).where(eq(account.userId, created.id));
    expect(accounts.map((a) => a.providerId).sort()).toEqual(["github", "google"]);
    expect((await authRow(email)).githubId).toBe(login);
  });

  test("ログイン済みの人が /update-user で githubId を書き換えても、保存されない(他人宛ての招待を横取りさせない)", async () => {
    const login = `octo-${uid()}`;
    const email = `cb-${crypto.randomUUID()}@example.com`;
    await loginWithGithub({ numericId: 1005, login, email });
    const { internalAdapter } = await auth.$context;
    const created = await authRow(email);
    const sess = await internalAdapter.createSession(created.id);
    const { authCookies, secret } = await auth.$context;
    const { serializeSignedCookie } = await import("better-call");
    const signed = (await serializeSignedCookie(authCookies.sessionToken.name, sess.token, secret)).split(";")[0]!;
    await auth.handler(
      new Request(`${baseURL}/api/auth/update-user`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin, cookie: signed },
        body: JSON.stringify({ githubId: "victim", name: "x" }),
      }),
    );
    expect((await authRow(email)).githubId).toBe(login);
  });
});
