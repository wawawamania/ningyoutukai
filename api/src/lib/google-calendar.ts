import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { account as authAccount, user as authUser } from "../db/auth-schema";

export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

type GoogleAccount = {
  id: string;
  scope: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
};

async function findGoogleAccount(email: string): Promise<GoogleAccount | null> {
  const [row] = await db
    .select({
      id: authAccount.id,
      scope: authAccount.scope,
      accessToken: authAccount.accessToken,
      refreshToken: authAccount.refreshToken,
      accessTokenExpiresAt: authAccount.accessTokenExpiresAt,
    })
    .from(authAccount)
    .innerJoin(authUser, eq(authAccount.userId, authUser.id))
    .where(and(eq(authUser.email, email), eq(authAccount.providerId, "google")))
    .limit(1);
  return row ?? null;
}

function hasCalendarScope(scope: string | null) {
	// Better Auth persists provider scopes as a comma-separated string, while
	// OAuth providers may return a space-separated value. Accept both formats.
	return scope?.split(/[\s,]+/).includes(GOOGLE_CALENDAR_EVENTS_SCOPE) ?? false;
}

export async function hasGoogleCalendarConnection(email: string) {
  const account = await findGoogleAccount(email);
  return Boolean(
    account &&
      hasCalendarScope(account.scope) &&
      account.refreshToken,
  );
}

async function refreshAccessToken(account: GoogleAccount): Promise<string | null> {
  if (!account.refreshToken) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    console.warn(`[google-calendar] token refresh failed (${response.status})`);
    return null;
  }

  const tokens = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!tokens.access_token) return null;

  const expiresAt =
    typeof tokens.expires_in === "number"
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;
  await db
    .update(authAccount)
    .set({
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    })
    .where(eq(authAccount.id, account.id));

  return tokens.access_token;
}

async function getAccessToken(account: GoogleAccount): Promise<string | null> {
  const expiresSoon =
    account.accessTokenExpiresAt !== null &&
    account.accessTokenExpiresAt.getTime() < Date.now() + 60_000;

  if (account.accessToken && !expiresSoon) return account.accessToken;
  return refreshAccessToken(account);
}

async function insertDeadlineEvent(
  accessToken: string,
  input: { taskId: string; taskName: string; dueAt: string },
) {
  const start = new Date(input.dueAt);
  const dateTime = start.toISOString();

  return fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: input.taskName,
        description: `人形使いのタスク期限 (taskId: ${input.taskId})`,
        start: { dateTime, timeZone: "Asia/Tokyo" },
        end: { dateTime, timeZone: "Asia/Tokyo" },
        extendedProperties: { private: { ningyoutukaiTaskId: input.taskId } },
      }),
    },
  );
}

/** カレンダー同期が失敗しても、タスク作成を失敗させないため結果を呼び出し元へ返す。 */
export async function addTaskDeadlineToGoogleCalendar(input: {
  email: string;
  taskId: string;
  taskName: string;
  dueAt: string;
}): Promise<"created" | "not-connected" | "failed"> {
  const account = await findGoogleAccount(input.email);
  if (
    !account ||
    !hasCalendarScope(account.scope) ||
    !account.refreshToken
  ) {
    return "not-connected";
  }

  let accessToken = await getAccessToken(account);
  if (!accessToken) return "failed";

  let response = await insertDeadlineEvent(accessToken, input);
  if (response.status === 401) {
    accessToken = await refreshAccessToken(account);
    if (accessToken) response = await insertDeadlineEvent(accessToken, input);
  }

  if (!response.ok) {
    console.warn(`[google-calendar] event insert failed (${response.status})`);
    return "failed";
  }
  return "created";
}
