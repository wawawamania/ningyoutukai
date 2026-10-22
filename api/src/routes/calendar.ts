import { Elysia } from "elysia";
import { authGuard } from "../lib/auth-guard";
import { hasGoogleCalendarConnection } from "../lib/google-calendar";

export const calendarRoutes = new Elysia({ name: "calendar-routes" })
  .use(authGuard)
  .get(
    "/api/calendar/status",
    async ({ user }) => ({
      connected: await hasGoogleCalendarConnection(user.email),
    }),
    {
      requireUser: true,
      detail: { summary: "Googleカレンダー連携状態" },
    },
  );
