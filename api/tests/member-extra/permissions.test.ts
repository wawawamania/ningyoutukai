import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { productMembers } from "../../src/db/schema";
import {
  cleanup,
  createOutsider,
  itemUrl,
  listUrl,
  memberExists,
  request,
  setupProduct,
  type MemberJson,
} from "./helpers";

afterAll(cleanup);

type Row = {
  who: "認証なし" | "所属していない人" | "メンバー" | "リーダー" | "削除済みのメンバー";
  list: [number, string | null];
  get: [number, string | null];
  del: [number, string | null];
};

const NOT_PRODUCT = "プロダクトが見つかりません";

// 期待の表(状態コードと message。本文なしは null)
const matrix: Row[] = [
  {
    who: "認証なし",
    list: [401, "ログインが必要です"],
    get: [401, "ログインが必要です"],
    del: [401, "ログインが必要です"],
  },
  {
    who: "所属していない人",
    list: [404, NOT_PRODUCT],
    get: [404, NOT_PRODUCT],
    del: [404, NOT_PRODUCT],
  },
  {
    who: "メンバー",
    list: [200, null],
    get: [200, null],
    del: [403, "プロダクトリーダーのみ実行できます"],
  },
  {
    who: "リーダー",
    list: [200, null],
    get: [200, null],
    del: [204, null],
  },
  {
    who: "削除済みのメンバー",
    list: [404, NOT_PRODUCT],
    get: [404, NOT_PRODUCT],
    del: [404, NOT_PRODUCT],
  },
];

describe("権限の表(行列)", () => {
  for (const row of matrix) {
    test(`${row.who}`, async () => {
      const { productId, leader, members } = await setupProduct({ members: 3 });
      const outsider = await createOutsider();
      // members[0] = 操作の対象、members[1] = メンバーの操作者、members[2] = 削除済みの人
      const target = members[0]!;
      await request("DELETE", itemUrl(productId, members[2]!.memberId), { cookie: leader.cookie });

      const cookie = {
        認証なし: undefined,
        所属していない人: outsider.cookie,
        メンバー: members[1]!.cookie,
        リーダー: leader.cookie,
        削除済みのメンバー: members[2]!.cookie,
      }[row.who];

      const check = async (res: Response, [status, message]: [number, string | null]) => {
        expect(res.status).toBe(status);
        if (message === null) return;
        expect(await res.json()).toEqual({ message });
      };

      await check(await request("GET", listUrl(productId), { cookie }), row.list);
      await check(await request("GET", itemUrl(productId, target.memberId), { cookie }), row.get);
      // 削除は最後(リーダーの場合は実際に消える)
      await check(await request("DELETE", itemUrl(productId, target.memberId), { cookie }), row.del);

      const deleted = !(await memberExists(target.memberId));
      expect(deleted).toBe(row.del[0] === 204);
    });
  }

  test("メンバーが削除を試みると、リーダー宛てでも 403(409 ではない)", async () => {
    const { productId, leader, members } = await setupProduct();
    const res = await request("DELETE", itemUrl(productId, leader.memberId), {
      cookie: members[0]!.cookie,
    });
    expect(res.status).toBe(403);
    expect(await memberExists(leader.memberId)).toBe(true);
  });

  test("メンバーは、自分自身の削除(脱退)もできない(403)", async () => {
    const { productId, members } = await setupProduct();
    const res = await request("DELETE", itemUrl(productId, members[0]!.memberId), {
      cookie: members[0]!.cookie,
    });
    expect(res.status).toBe(403);
    expect(await memberExists(members[0]!.memberId)).toBe(true);
  });

  test("別のプロダクトのリーダーは、自分のプロダクトではないメンバーを削除できない(404)", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    const res = await request("DELETE", itemUrl(a.productId, a.members[0]!.memberId), {
      cookie: b.leader.cookie,
    });
    expect(res.status).toBe(404);
    expect(await memberExists(a.members[0]!.memberId)).toBe(true);
    // 自分のプロダクトの URL に、他プロダクトのメンバー ID を入れても消えない
    const res2 = await request("DELETE", itemUrl(b.productId, a.members[0]!.memberId), {
      cookie: b.leader.cookie,
    });
    expect(res2.status).toBe(404);
    expect(await memberExists(a.members[0]!.memberId)).toBe(true);
  });

  test("2 つのプロダクトに所属する人は、プロダクトごとの権限になる(片方でリーダー、もう片方でメンバー)", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    // a のリーダーを、b にメンバーとして参加させる
    await db
      .insert(productMembers)
      .values({ productId: b.productId, userId: a.leader.userId, role: "member" });

    const asMember = await request("DELETE", itemUrl(b.productId, b.members[0]!.memberId), {
      cookie: a.leader.cookie,
    });
    expect(asMember.status).toBe(403);
    const asLeader = await request("DELETE", itemUrl(a.productId, a.members[0]!.memberId), {
      cookie: a.leader.cookie,
    });
    expect(asLeader.status).toBe(204);

    // b の一覧には、a のリーダーが member として載る
    const list = await request("GET", listUrl(b.productId), { cookie: b.leader.cookie });
    const rows = (await list.json()) as MemberJson[];
    expect(rows.find((m) => m.userId === a.leader.userId)?.role).toBe("member");
    expect(rows.length).toBe(4);
  });
});

describe("削除したメンバーの再参加(確認)", () => {
  test("削除後に、同じユーザーを同じプロダクトへ再び参加させられる(新しい productMemberId になる)", async () => {
    const { productId, leader, members } = await setupProduct();
    const old = members[0]!;
    const res = await request("DELETE", itemUrl(productId, old.memberId), { cookie: leader.cookie });
    expect(res.status).toBe(204);

    const [again] = await db
      .insert(productMembers)
      .values({ productId, userId: old.userId, role: "member" })
      .returning();
    expect(again!.productMemberId).not.toBe(old.memberId);

    // 古い memberId は 404 のまま、新しい memberId は 200
    expect((await request("GET", itemUrl(productId, old.memberId), { cookie: leader.cookie })).status).toBe(404);
    expect(
      (await request("GET", itemUrl(productId, again!.productMemberId), { cookie: leader.cookie })).status
    ).toBe(200);
    // 元の cookie でまたプロダクトを見られる
    expect((await request("GET", listUrl(productId), { cookie: old.cookie })).status).toBe(200);
    const rows = await db
      .select()
      .from(productMembers)
      .where(eq(productMembers.productId, productId));
    expect(rows.length).toBe(3);
  });
});
