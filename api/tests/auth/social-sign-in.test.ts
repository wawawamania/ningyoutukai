import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// ---- 土台: 環境変数は auth を import する前に設定する(実際の OAuth 通信は行わない) ----
process.env.GITHUB_CLIENT_ID = "test-github-client-id";
process.env.GITHUB_CLIENT_SECRET = "test-github-client-secret";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.WEB_ORIGIN ??= "http://localhost:3000";

// better-auth は NODE_ENV=test(bun test のデフォルト)だと Origin / callbackURL の検証を
// スキップするため、本番同様に検証が走る状態で auth を読み込む
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "development";
const { auth } = await import("../../src/auth");
const authContext = await auth.$context; // コンテキスト生成時に NODE_ENV が参照される
process.env.NODE_ENV = originalNodeEnv;
void authContext;

const baseURL = process.env.BETTER_AUTH_URL!;
const webOrigin = process.env.WEB_ORIGIN!;

type Json = Record<string, unknown>;

async function post(path: string, body: Json, origin: string | null = webOrigin, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  const res = await auth.handler(
    new Request(`${baseURL}${path}`, { method: "POST", headers, body: JSON.stringify(body) }),
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, json };
}

const signInSocial = (body: Json, origin: string | null = webOrigin, cookie?: string) =>
  post("/api/auth/sign-in/social", body, origin, cookie);

// テストで作成され得る user / verification(state)を片付ける
const createdEmails = new Set<string>();
const createdStates = new Set<string>();

async function cleanup() {
  const { db } = await import("../../src/db");
  const schema = await import("../../src/db/auth-schema");
  const { inArray } = await import("drizzle-orm");
  if (createdEmails.size > 0) {
    await db.delete(schema.user).where(inArray(schema.user.email, [...createdEmails]));
  }
  if (createdStates.size > 0) {
    await db.delete(schema.verification).where(inArray(schema.verification.identifier, [...createdStates]));
  }
}

function track(url: string) {
  const state = new URL(url).searchParams.get("state");
  if (state) createdStates.add(state);
}

afterAll(async () => {
  await cleanup();
  // DB プールは他のテストファイルと共有されるため、ここでは閉じない
});

describe("POST /api/auth/sign-in/social", () => {
  test("github: 認可 URL を返し、state と client_id を含む", async () => {
    const { res, json } = await signInSocial({ provider: "github" });
    expect(res.status).toBe(200);
    expect(json.redirect).toBe(true);
    track(json.url);

    const url = new URL(json.url);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-github-client-id");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/auth/callback/github`);
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  test("github: 呼び出しごとに異なる state が発行される", async () => {
    const a = await signInSocial({ provider: "github" });
    const b = await signInSocial({ provider: "github" });
    track(a.json.url);
    track(b.json.url);
    const sa = new URL(a.json.url).searchParams.get("state");
    const sb = new URL(b.json.url).searchParams.get("state");
    expect(sa).not.toBe(sb);
  });

  test("google: 認可 URL を返す", async () => {
    const { res, json } = await signInSocial({ provider: "google" });
    expect(res.status).toBe(200);
    track(json.url);

    const url = new URL(json.url);
    expect(url.host).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/auth/callback/google`);
  });

  test("callbackURL を指定してもリクエストが受理される(認可 URL 自体には含まれず state に紐づく)", async () => {
    const callbackURL = `${webOrigin}/dashboard`;
    const { res, json } = await signInSocial({ provider: "github", callbackURL });
    expect(res.status).toBe(200);
    track(json.url);
    // redirect_uri は常に API 側のコールバックで、callbackURL は URL に露出しない
    const url = new URL(json.url);
    expect(url.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/auth/callback/github`);
    expect(json.url).not.toContain("dashboard");
  });

  test("callbackURL が信頼されていないオリジンの場合は拒否される", async () => {
    const { res } = await signInSocial({ provider: "github", callbackURL: "https://evil.example.com/steal" });
    expect(res.status).toBe(403);
  });

  test("Cookie 付きで Origin が信頼されていないオリジンの場合は拒否される(CSRF)", async () => {
    // better-auth の Origin 検証は Cookie を伴うリクエストが対象
    const { res } = await signInSocial({ provider: "github" }, "https://evil.example.com", "better-auth.session_token=dummy");
    expect(res.status).toBe(403);
  });

  test("未設定のプロバイダ(discord)は 4xx エラー", async () => {
    const { res, json } = await signInSocial({ provider: "discord" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(json.code).toBe("PROVIDER_NOT_FOUND");
    expect(json.url).toBeUndefined();
  });

  test("provider 未指定は 4xx エラー", async () => {
    const { res, json } = await signInSocial({});
    expect(res.status).toBe(400);
    expect(json.code).toBe("VALIDATION_ERROR");
  });
});

describe("パスワード認証は無効", () => {
  test("POST /api/auth/sign-up/email は成功せず、ユーザーも作られない", async () => {
    const email = `social-test-${crypto.randomUUID()}@example.com`;
    createdEmails.add(email);
    const { res, json } = await post("/api/auth/sign-up/email", {
      email,
      password: "password1234",
      name: "Test User",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(json?.token).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();

    const { db } = await import("../../src/db");
    const schema = await import("../../src/db/auth-schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(schema.user).where(eq(schema.user.email, email));
    expect(rows).toHaveLength(0);
  });

  test("POST /api/auth/sign-in/email は成功せず、セッションが発行されない", async () => {
    const { res, json } = await post("/api/auth/sign-in/email", {
      email: "nobody@example.com",
      password: "password1234",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(json?.code).toBe("EMAIL_PASSWORD_DISABLED");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
