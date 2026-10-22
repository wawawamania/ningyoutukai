import { afterAll, describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { getSchemaValidator } from "elysia";
import { productMembers, users } from "../../src/db/schema";
import { memberColumns, memberSchema, messageSchema } from "../../src/lib/member-view";
import {
  cleanup,
  itemUrl,
  listUrl,
  memberKeys,
  request,
  setAvatar,
  setUserName,
  setupProduct,
  type MemberJson,
} from "./helpers";
import { db } from "../../src/db";
import { eq } from "drizzle-orm";

afterAll(cleanup);

describe("member-view の単体", () => {
  test("memberColumns は公開してよい 5 項目だけで、連絡先・外部サービスの ID を含まない", () => {
    expect(Object.keys(memberColumns).sort()).toEqual(memberKeys);
    for (const forbidden of ["email", "githubId", "googleSub"]) {
      expect(forbidden in memberColumns).toBe(false);
    }
    // 列の参照元: 識別子は product_members、人の情報は users
    expect(memberColumns.productMemberId).toBe(productMembers.productMemberId);
    expect(memberColumns.role).toBe(productMembers.role);
    expect(memberColumns.userId).toBe(users.userId);
    expect(memberColumns.userName).toBe(users.userName);
    expect(memberColumns.avatarUrl).toBe(users.avatarUrl);
  });

  test("users の列のうち、公開されない列は email・githubId・googleSub だけ", () => {
    const exposed = new Set(Object.keys(memberColumns));
    const hidden = Object.keys(getTableColumns(users)).filter((k) => !exposed.has(k));
    expect(hidden.sort()).toEqual(["email", "githubId", "googleSub"]);
  });

  test("memberSchema は正しい形を受け入れ、余計な項目の欠落・型違い・不正な role を拒否する", () => {
    const v = getSchemaValidator(memberSchema);
    const ok = {
      productMemberId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      userName: "名前",
      avatarUrl: null,
      role: "member",
    };
    expect(v.Check(ok)).toBe(true);
    expect(v.Check({ ...ok, avatarUrl: "https://example.com/a.png" })).toBe(true);
    expect(v.Check({ ...ok, role: "leader" })).toBe(true);
    expect(v.Check({ ...ok, role: "admin" })).toBe(false);
    expect(v.Check({ ...ok, avatarUrl: undefined })).toBe(false);
    expect(v.Check({ ...ok, avatarUrl: 1 })).toBe(false);
    expect(v.Check({ ...ok, userName: null })).toBe(false);
    const { userId: _omit, ...withoutUserId } = ok;
    expect(v.Check(withoutUserId)).toBe(false);
  });

  test("messageSchema は { message: string } だけを受け入れる", () => {
    const v = getSchemaValidator(messageSchema);
    expect(v.Check({ message: "x" })).toBe(true);
    expect(v.Check({ message: 1 })).toBe(false);
    expect(v.Check({})).toBe(false);
  });
});

describe("応答の形", () => {
  test("avatarUrl が null / 文字列のとき、型が保たれる(一覧・個別とも)", async () => {
    const { productId, leader, members } = await setupProduct();
    await setAvatar(members[0]!.userId, "https://example.com/avatar.png");
    await setAvatar(members[1]!.userId, null);

    const list = (await (
      await request("GET", listUrl(productId), { cookie: leader.cookie })
    ).json()) as MemberJson[];
    const byId = new Map(list.map((m) => [m.productMemberId, m]));
    expect(byId.get(members[0]!.memberId)!.avatarUrl).toBe("https://example.com/avatar.png");
    expect(byId.get(members[1]!.memberId)!.avatarUrl).toBeNull();

    const one = (await (
      await request("GET", itemUrl(productId, members[1]!.memberId), { cookie: leader.cookie })
    ).json()) as MemberJson;
    expect(one.avatarUrl).toBeNull();
    expect("avatarUrl" in one).toBe(true);
  });

  test("email・githubId・googleSub が DB にあっても、キーにも値にも出ない", async () => {
    const { productId, leader, members } = await setupProduct();
    const secretGithub = `gh-${crypto.randomUUID()}`;
    const secretGoogle = `gg-${crypto.randomUUID()}`;
    await db
      .update(users)
      .set({ githubId: secretGithub, googleSub: secretGoogle })
      .where(eq(users.userId, members[0]!.userId));
    try {
      const responses = [
        await request("GET", listUrl(productId), { cookie: members[1]!.cookie }),
        await request("GET", itemUrl(productId, members[0]!.memberId), { cookie: members[1]!.cookie }),
      ];
      for (const res of responses) {
        const text = await res.text();
        for (const secret of [secretGithub, secretGoogle, "@example.com", members[0]!.email]) {
          expect(text).not.toContain(secret);
        }
        const json = JSON.parse(text) as MemberJson | MemberJson[];
        for (const m of Array.isArray(json) ? json : [json]) {
          expect(Object.keys(m).sort()).toEqual(memberKeys);
          expect(typeof m.productMemberId).toBe("string");
          expect(typeof m.userId).toBe("string");
          expect(typeof m.userName).toBe("string");
        }
      }
    } finally {
      await db
        .update(users)
        .set({ githubId: null, googleSub: null })
        .where(eq(users.userId, members[0]!.userId));
    }
  });

  test("ユーザー名に特殊な文字(引用符・タグ・改行・長い文字列)があっても、そのまま返る", async () => {
    const { productId, leader, members } = await setupProduct({ members: 3 });
    const names = ['"quote"', "<script>alert(1)</script>", "a\nb", "あ".repeat(500)];
    await setUserName(members[0]!.userId, names[0]!);
    await setUserName(members[1]!.userId, names[1]!);
    await setUserName(members[2]!.userId, names[2]!);
    await setUserName(leader.userId, names[3]!);
    const res = await request("GET", listUrl(productId), { cookie: leader.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const list = (await res.json()) as MemberJson[];
    expect(list.map((m) => m.userName).sort()).toEqual([...names].sort());
  });

  test("成功・失敗とも content-type は JSON で、404 は日本語の { message } だけ", async () => {
    const { productId, leader } = await setupProduct();
    const ok = await request("GET", itemUrl(productId, leader.memberId), { cookie: leader.cookie });
    expect(ok.headers.get("content-type")).toContain("application/json");
    const ng = await request("GET", itemUrl(productId, crypto.randomUUID()), {
      cookie: leader.cookie,
    });
    expect(ng.headers.get("content-type")).toContain("application/json");
    const body = (await ng.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["message"]);
  });
});
