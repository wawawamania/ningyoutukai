import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { serializeSignedCookie } from "better-call";
import { auth } from "../../src/auth";
import { db } from "../../src/db";
import {
  productMembers,
  products,
  taskTypes,
  tasks,
  users,
} from "../../src/db/schema";
import { taskRoutes } from "../../src/routes/task";

/** タスク API のテスト共通ヘルパー。各テストファイルから import して使う。 */

const app = new Elysia().use(taskRoutes);

export type Actor = {
  /** better-auth の user.id */
  authUserId: string;
  email: string;
  /** リクエストの cookie ヘッダに渡す値 */
  cookie: string;
  /** アプリ側 users.user_id */
  userId: string;
  /** product_members.product_member_id */
  memberId: string;
  role: "leader" | "member";
};

const createdAuthUserIds: string[] = [];
const createdProductIds: string[] = [];

async function ctx() {
  return await auth.$context;
}

async function createActor(
  productId: string,
  role: "leader" | "member",
  label: string
): Promise<Actor> {
  const { internalAdapter, authCookies, secret } = await ctx();
  const email = `task-test-${crypto.randomUUID()}@example.com`;

  // better-auth のユーザーとセッションを DB に直接作る(パスワード認証・OAuth には依存しない)
  const authUser = await internalAdapter.createUser(
    { email, name: label, emailVerified: true },
    { method: "admin" }
  );
  createdAuthUserIds.push(authUser.id);
  const session = await internalAdapter.createSession(authUser.id);
  const signed = await serializeSignedCookie(
    authCookies.sessionToken.name,
    session.token,
    secret
  );

  // アプリ側 users の行(メールで対応づける仕組みと同じ)と、プロダクトのメンバー
  const [appUser] = await db
    .insert(users)
    .values({ userName: label, email })
    .returning();
  const [member] = await db
    .insert(productMembers)
    .values({ productId, userId: appUser.userId, role })
    .returning();

  return {
    authUserId: authUser.id,
    email,
    cookie: signed.split(";")[0]!,
    userId: appUser.userId,
    memberId: member.productMemberId,
    role,
  };
}

/**
 * プロダクトを 1 つ作り、リーダー 1 人とメンバー `members` 人(既定 2)を参加させる。
 * メンバーを追加する API はまだ無いので、DB に直接作る。
 */
export async function setupProduct(opts: { members?: number } = {}) {
  const [product] = await db
    .insert(products)
    .values({ productName: `task-test-${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  createdProductIds.push(product.productId);

  const leader = await createActor(product.productId, "leader", "leader");
  const members: Actor[] = [];
  for (let i = 0; i < (opts.members ?? 2); i++) {
    members.push(await createActor(product.productId, "member", `member${i + 1}`));
  }
  return { productId: product.productId, leader, members };
}

/** 所属していない(どのプロダクトにも入っていない)ログイン済みユーザーを作る */
export async function createOutsider(): Promise<Pick<Actor, "authUserId" | "email" | "cookie">> {
  const { internalAdapter, authCookies, secret } = await ctx();
  const email = `task-test-${crypto.randomUUID()}@example.com`;
  const authUser = await internalAdapter.createUser(
    { email, name: "outsider", emailVerified: true },
    { method: "admin" }
  );
  createdAuthUserIds.push(authUser.id);
  const session = await internalAdapter.createSession(authUser.id);
  const signed = await serializeSignedCookie(
    authCookies.sessionToken.name,
    session.token,
    secret
  );
  return { authUserId: authUser.id, email, cookie: signed.split(";")[0]! };
}

/** プロダクトにタスクの種類を直接作る(タスクの種類の API はまだ無い) */
export async function createTaskType(productId: string, name = "デザイン") {
  const [row] = await db
    .insert(taskTypes)
    .values({ productId, taskTypeName: `${name}-${crypto.randomUUID().slice(0, 6)}` })
    .returning();
  return row;
}

/** タスクを DB に直接作る(取得・更新・完了系のテストの前提データ用) */
export async function insertTask(
  memberId: string,
  values: Partial<typeof tasks.$inferInsert> = {}
) {
  const [row] = await db
    .insert(tasks)
    .values({ taskName: "テストタスク", productMemberId: memberId, ...values })
    .returning();
  return row;
}

export async function findTask(taskId: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.taskId, taskId));
  return row;
}

export async function countTasks(productId: string) {
  const rows = await db
    .select({ taskId: tasks.taskId })
    .from(tasks)
    .innerJoin(productMembers, eq(tasks.productMemberId, productMembers.productMemberId))
    .where(eq(productMembers.productId, productId));
  return rows.length;
}

type Opts = { cookie?: string; body?: unknown };

/** タスク API を呼ぶ。path は `/api/product/...` から始まる絶対パス */
export function request(method: string, path: string, { cookie, body }: Opts = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

/** テストで作ったユーザー・プロダクトをすべて削除する(afterAll で呼ぶ) */
export async function cleanup() {
  const { internalAdapter } = await ctx();

  // products を消すと、product_members・task_types・tasks は cascade で消える
  if (createdProductIds.length > 0) {
    await db.delete(products).where(inArray(products.productId, createdProductIds));
  }
  // アプリ側 users は、test 用のメールのものを消す
  const emails: string[] = [];
  for (const id of createdAuthUserIds) {
    const u = await internalAdapter.findUserById(id);
    if (u) emails.push(u.email);
  }
  if (emails.length > 0) {
    await db.delete(users).where(inArray(users.email, emails));
  }
  for (const id of createdAuthUserIds) {
    // セッション・アカウントは deleteUser が一緒に削除する
    await internalAdapter.deleteUser(id);
  }
  createdAuthUserIds.length = 0;
  createdProductIds.length = 0;
}
