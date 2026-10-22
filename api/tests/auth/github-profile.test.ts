import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { serializeSignedCookie } from "better-call";
import { eq, inArray } from "drizzle-orm";
import { auth, mapGithubProfile } from "../../src/auth";
import { db } from "../../src/db";
import { users } from "../../src/db/schema";
import { getOrCreateAppUser } from "../../src/lib/app-user";

// GitHub のユーザー名(login)を、better-auth の user と、アプリ側の users に保存する

const createdAuthIds: string[] = [];
const createdEmails: string[] = [];
const uid = () => crypto.randomUUID().slice(0, 8);

afterEach(async () => {
  if (createdEmails.length > 0) {
    await db.delete(users).where(inArray(users.email, createdEmails));
    createdEmails.length = 0;
  }
});
afterAll(async () => {
  const { internalAdapter } = await auth.$context;
  for (const id of createdAuthIds) await internalAdapter.deleteUser(id);
});

const newEmail = () => {
  const email = `gh-${crypto.randomUUID()}@example.com`;
  createdEmails.push(email);
  return email;
};
const findAppUser = async (email: string) =>
  (await db.select().from(users).where(eq(users.email, email)))[0];

describe("mapGithubProfile(GitHub のプロフィールの扱い)", () => {
  test("戻り値に githubId を入れない(input: false の項目は better-auth が捨てるため。保存は account フックが行う)", () => {
    expect(mapGithubProfile({ id: 1, login: "octocat" })).toEqual({});
  });
});

describe("better-auth の user に githubId が保存され、セッションから取れる", () => {
  test("githubId つきで作ったユーザーは、get-session で githubId を返す", async () => {
    const { internalAdapter, authCookies, secret } = await auth.$context;
    const email = newEmail();
    const login = `octo-${uid()}`;
    const user = await internalAdapter.createUser(
      { email, name: "gh", emailVerified: true, githubId: login } as never,
      { method: "admin" } as never,
    );
    createdAuthIds.push(user.id);
    const session = await internalAdapter.createSession(user.id);
    const signed = await serializeSignedCookie(
      authCookies.sessionToken.name,
      session.token,
      secret,
    );
    const res = await auth.handler(
      new Request("http://localhost:3001/api/auth/get-session", {
        headers: { cookie: signed.split(";")[0]! },
      }),
    );
    const body = await res.json();
    expect(body.user.githubId).toBe(login);
  });
});

describe("アプリ側 users への写し", () => {
  test("githubId つきでも、メールアドレスで対応づけ、GitHub のユーザー名を保存する", async () => {
    const email = newEmail();
    const login = `octo-${uid()}`;
    const row = await getOrCreateAppUser({ email, name: "gh", githubId: login });
    expect(row.githubId).toBe(login);
    expect((await findAppUser(email))?.githubId).toBe(login);
  });

  test("githubId がなければ(Google でログインした人など)、github_id は null のまま", async () => {
    const email = newEmail();
    const row = await getOrCreateAppUser({ email, name: "g" });
    expect(row.githubId).toBeNull();
  });

  test("ログインのたびに、ユーザー名の変更に追従する", async () => {
    const email = newEmail();
    const before = `old-${uid()}`;
    const after = `new-${uid()}`;
    const first = await getOrCreateAppUser({ email, name: "gh", githubId: before });
    expect(first.githubId).toBe(before);

    const second = await getOrCreateAppUser({ email, name: "gh", githubId: after });
    expect(second.userId).toBe(first.userId);
    expect(second.githubId).toBe(after);
    expect((await findAppUser(email))?.githubId).toBe(after);
  });

  test("githubId なしで呼んでも、すでに保存したユーザー名は消えない", async () => {
    const email = newEmail();
    const login = `keep-${uid()}`;
    await getOrCreateAppUser({ email, name: "gh", githubId: login });
    const again = await getOrCreateAppUser({ email, name: "gh" });
    expect(again.githubId).toBe(login);
  });

  test("別の人がすでに同じユーザー名を持っていても、500 にならず、写さない", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const login = `dup-${uid()}`;
    const a = await getOrCreateAppUser({ email: newEmail(), name: "a", githubId: login });
    expect(a.githubId).toBe(login);

    const emailB = newEmail();
    const b = await getOrCreateAppUser({ email: emailB, name: "b", githubId: login });
    expect(b.email).toBe(emailB);
    expect(b.githubId).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("同時に何度呼んでも、users の行は 1 つで、ユーザー名が入る", async () => {
    const email = newEmail();
    const login = `race-${uid()}`;
    const rows = await Promise.all(
      Array.from({ length: 5 }, () => getOrCreateAppUser({ email, name: "gh", githubId: login })),
    );
    expect(new Set(rows.map((r) => r.userId)).size).toBe(1);
    const all = await db.select().from(users).where(eq(users.email, email));
    expect(all).toHaveLength(1);
    expect(all[0]!.githubId).toBe(login);
  });
});
