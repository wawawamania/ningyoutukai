import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { productInvitations } from "../../src/db/schema";
import { addressedTo, type Invitee } from "../../src/lib/invitation";
import { cleanup, cleanupRawUsers, insertRawUser, setupProduct } from "./helpers";

// addressedTo(自分宛ての判定)の関数単位のテスト。app.handle は通さず、DB に直接招待を作って確認する。

let productId: string;
beforeAll(async () => {
  productId = (await setupProduct({ members: 0 })).productId;
});
afterAll(async () => {
  await cleanupRawUsers();
  await cleanup();
});

type Seed = {
  userId?: string | null;
  inviteeType: "github" | "gmail";
  inviteeIdentifier: string;
  status?: "pending" | "accepted" | "declined";
};

async function seed(v: Seed) {
  const [row] = await db
    .insert(productInvitations)
    .values({
      productId,
      userId: v.userId ?? null,
      inviteeType: v.inviteeType,
      inviteeIdentifier: v.inviteeIdentifier,
      status: v.status ?? "pending",
    })
    .returning();
  return row!.invitationId;
}

/** この人宛てとして見える招待の id の一覧(addressedTo だけで絞る。status は見ない) */
async function visibleTo(me: Invitee) {
  const rows = await db
    .select({ id: productInvitations.invitationId })
    .from(productInvitations)
    .where(addressedTo(me));
  return rows.map((r) => r.id);
}

async function me(opts: { email?: string; githubId?: string | null } = {}): Promise<Invitee> {
  const u = await insertRawUser(opts);
  return { userId: u.userId, email: u.email, githubId: u.githubId };
}

describe("addressedTo: user_id で判定する場合", () => {
  it("user_id が自分なら、招待先の文字列が何であれ自分宛て", async () => {
    const m = await me();
    const id = await seed({ userId: m.userId, inviteeType: "gmail", inviteeIdentifier: "someone-else@example.com" });
    expect(await visibleTo(m)).toEqual([id]);
  });
  it("user_id が他人なら、招待先が自分のメールと一致していても、他人宛て", async () => {
    const m = await me();
    const other = await me();
    await seed({ userId: other.userId, inviteeType: "gmail", inviteeIdentifier: m.email });
    expect(await visibleTo(m)).toEqual([]);
    expect((await visibleTo(other)).length).toBe(1);
  });
  it("user_id が他人なら、招待先が自分の GitHub username と一致していても、他人宛て", async () => {
    const gh = `gh-${crypto.randomUUID().slice(0, 8)}`;
    const m = await me({ githubId: gh });
    const other = await me();
    await seed({ userId: other.userId, inviteeType: "github", inviteeIdentifier: gh });
    expect(await visibleTo(m)).toEqual([]);
  });
});

describe("addressedTo: user_id が null(未登録で招待された)場合", () => {
  it("メールが一致すれば自分宛て、一致しなければ他人宛て", async () => {
    const m = await me();
    const hit = await seed({ inviteeType: "gmail", inviteeIdentifier: m.email });
    await seed({ inviteeType: "gmail", inviteeIdentifier: `x-${m.email}` });
    expect(await visibleTo(m)).toEqual([hit]);
  });
  it("メールの大文字・小文字は区別しない(招待側が大文字でも、自分のメールが大文字でも)", async () => {
    const m = await me();
    const upperInvite = await seed({ inviteeType: "gmail", inviteeIdentifier: m.email.toUpperCase() });
    expect(await visibleTo(m)).toEqual([upperInvite]);

    const mixed = await me({ email: `Inv-Extra-${crypto.randomUUID()}@Example.COM` });
    const lowerInvite = await seed({ inviteeType: "gmail", inviteeIdentifier: mixed.email.toLowerCase() });
    expect(await visibleTo(mixed)).toEqual([lowerInvite]);
  });
  it("GitHub username が一致すれば自分宛て(大文字・小文字は区別しない)", async () => {
    const gh = `Gh-${crypto.randomUUID().slice(0, 8)}`;
    const m = await me({ githubId: gh });
    const a = await seed({ inviteeType: "github", inviteeIdentifier: gh });
    const b = await seed({ inviteeType: "github", inviteeIdentifier: gh.toLowerCase() });
    const c = await seed({ inviteeType: "github", inviteeIdentifier: gh.toUpperCase() });
    expect((await visibleTo(m)).sort()).toEqual([a, b, c].sort());
  });
  it("GitHub username が一致しなければ他人宛て", async () => {
    const m = await me({ githubId: `gh-${crypto.randomUUID().slice(0, 8)}` });
    await seed({ inviteeType: "github", inviteeIdentifier: `other-${crypto.randomUUID().slice(0, 8)}` });
    expect(await visibleTo(m)).toEqual([]);
  });
  it("GitHub username を持たない人には、github 型の招待は届かない(識別子が空でも、メール文字列でも)", async () => {
    const m = await me({ githubId: null });
    await seed({ inviteeType: "github", inviteeIdentifier: "" });
    await seed({ inviteeType: "github", inviteeIdentifier: m.email });
    expect(await visibleTo(m)).toEqual([]);
  });
  it("型が違う招待には一致しない(github 型の識別子が自分のメール、gmail 型の識別子が自分の GitHub username)", async () => {
    const gh = `gh-${crypto.randomUUID().slice(0, 8)}`;
    const m = await me({ githubId: gh });
    await seed({ inviteeType: "github", inviteeIdentifier: m.email });
    await seed({ inviteeType: "gmail", inviteeIdentifier: gh });
    expect(await visibleTo(m)).toEqual([]);
  });
  it("LIKE のワイルドカード(%, _)を含む識別子は、パターンとして解釈されない", async () => {
    const m = await me();
    await seed({ inviteeType: "gmail", inviteeIdentifier: "%" });
    await seed({ inviteeType: "gmail", inviteeIdentifier: "%@example.com" });
    await seed({ inviteeType: "gmail", inviteeIdentifier: m.email.replace(/^./, "_") });
    expect(await visibleTo(m)).toEqual([]);
  });
  it("前後に空白のある識別子は一致しない(正規化はしない)", async () => {
    const m = await me();
    await seed({ inviteeType: "gmail", inviteeIdentifier: ` ${m.email}` });
    expect(await visibleTo(m)).toEqual([]);
  });
  it("メールのユーザー名の部分の大文字・小文字以外の違い(+ や . の別名)は別人として扱う", async () => {
    const m = await me({ email: `alias.${crypto.randomUUID().slice(0, 8)}@example.com` });
    await seed({ inviteeType: "gmail", inviteeIdentifier: m.email.replace("alias.", "alias+tag.") });
    await seed({ inviteeType: "gmail", inviteeIdentifier: m.email.replace("alias.", "alias") });
    expect(await visibleTo(m)).toEqual([]);
  });
  it("同じ文字列でも、他人のメールの招待は自分に届かない", async () => {
    const a = await me();
    const b = await me();
    const id = await seed({ inviteeType: "gmail", inviteeIdentifier: a.email });
    expect(await visibleTo(b)).toEqual([]);
    expect(await visibleTo(a)).toEqual([id]);
  });
});

describe("addressedTo: 状態", () => {
  it("addressedTo 自体は状態を見ない(保留中以外も含む)。絞り込みは呼び出し側で行う", async () => {
    const m = await me();
    const id = await seed({ userId: m.userId, inviteeType: "gmail", inviteeIdentifier: m.email, status: "declined" });
    expect(await visibleTo(m)).toEqual([id]);
    await db.delete(productInvitations).where(eq(productInvitations.invitationId, id));
  });
});
