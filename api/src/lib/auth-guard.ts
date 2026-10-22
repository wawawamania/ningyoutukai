import { Elysia } from "elysia";
import { auth } from "../auth";
import { getOrCreateAppUser } from "./app-user";
import { errorHandler } from "./error-handler";

/**
 * ログイン必須のルートに `{ requireUser: true }` を付けると、
 * 未ログインは 401、ログイン済みなら `user`(アプリ側の `users` の行)が使える。
 */
export const authGuard = new Elysia({ name: "auth-guard" })
  .use(errorHandler)
  .macro({
  requireUser: {
    async resolve({ request, status }) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return status(401, { message: "ログインが必要です" });

      const user = await getOrCreateAppUser(session.user);
      return { user };
    },
  },
});
