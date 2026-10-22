import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";

type AuthUser = {
  email: string;
  name: string;
  image?: string | null;
  /** GitHub のユーザー名(GitHub でログインした人だけ。`auth.ts` の mapGithubProfile) */
  githubId?: string | null;
};

// PostgreSQL の unique 制約違反
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === UNIQUE_VIOLATION || err?.cause?.code === UNIQUE_VIOLATION;
}

/**
 * better-auth のユーザー(`user`)に対応するアプリ側のユーザー(`users`)を返す。なければ作る。
 *
 * TODO(v2): `users` と better-auth の `user` は二重管理になっている。
 * メールアドレスで対応づけているのは暫定対応で、v2 でテーブルを統一する。
 */
export async function getOrCreateAppUser(authUser: AuthUser) {
  const find = async () => {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, authUser.email));
    return row;
  };

  let row = await find();

  if (!row) {
    // 同時リクエストで二重に作られても、unique(email) で片方に収束させる
    await db
      .insert(users)
      .values({
        userName: authUser.name,
        email: authUser.email,
        avatarUrl: authUser.image ?? null,
      })
      .onConflictDoNothing({ target: users.email });
    row = (await find())!;
  }

  // GitHub のユーザー名を写す(ユーザー名の変更にも追従する)。
  // users.github_id は unique なので、別の人がすでに同じ値を持っていても、500 にはせず、写さない
  if (authUser.githubId && row.githubId !== authUser.githubId) {
    try {
      const [updated] = await db
        .update(users)
        .set({ githubId: authUser.githubId })
        .where(eq(users.userId, row.userId))
        .returning();
      if (updated) row = updated;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      console.warn(
        `[app-user] GitHub のユーザー名 ${authUser.githubId} は、別のユーザーが使っているため、写しませんでした`,
      );
    }
  }

  return row;
}
