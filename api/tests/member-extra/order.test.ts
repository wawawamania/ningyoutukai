import { afterAll, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { productMembers } from "../../src/db/schema";
import {
  cleanup,
  listUrl,
  request,
  setUserName,
  setupProduct,
  type MemberJson,
} from "./helpers";

afterAll(cleanup);

async function listNames(productId: string, cookie: string) {
  const res = await request("GET", listUrl(productId), { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as MemberJson[];
}

describe("メンバー一覧の並び順", () => {
  test("同名のメンバーは productMemberId の昇順で、何度呼んでも同じ順になる", async () => {
    const { productId, leader, members } = await setupProduct({ members: 5 });
    for (const m of members) await setUserName(m.userId, "同じ名前");

    const first = await listNames(productId, leader.cookie);
    const sameName = first.filter((m) => m.userName === "同じ名前").map((m) => m.productMemberId);
    expect(sameName.length).toBe(5);
    expect(sameName).toEqual([...sameName].sort());

    for (let i = 0; i < 5; i++) {
      const again = await listNames(productId, members[i % 5]!.cookie);
      expect(again.map((m) => m.productMemberId)).toEqual(first.map((m) => m.productMemberId));
    }
  });

  test("リーダーが同名のメンバーと並んでも、リーダーが先", async () => {
    const { productId, leader, members } = await setupProduct({ members: 3 });
    await setUserName(leader.userId, "同じ名前");
    for (const m of members) await setUserName(m.userId, "同じ名前");
    const list = await listNames(productId, members[0]!.cookie);
    expect(list[0]!.productMemberId).toBe(leader.memberId);
    expect(list.slice(1).map((m) => m.role)).toEqual(["member", "member", "member"]);
  });

  test("名前が辞書順で最後でも、最初でも、リーダーが先頭", async () => {
    for (const leaderName of ["zzzz", "AAAA", "あ", "ん", "🙂", "!"]) {
      const { productId, leader, members } = await setupProduct({ members: 2 });
      await setUserName(leader.userId, leaderName);
      await setUserName(members[0]!.userId, "000");
      await setUserName(members[1]!.userId, "mmm");
      const list = await listNames(productId, leader.cookie);
      expect(list[0]!.productMemberId).toBe(leader.memberId);
    }
  });

  test("ひらがな・カタカナ・漢字・英字・絵文字・数字が混ざっても、落ちずに、毎回同じ順で、全員が 1 回ずつ返る", async () => {
    const names = [
      "あきら",
      "アキラ",
      "亜希良",
      "Akira",
      "akira",
      "🙂🙂",
      "123",
      "ａｋｉｒａ",
      "ｱｷﾗ",
      "　全角スペース",
      " 先頭スペース",
      "山田 太郎",
      "山田太郎",
      "Zed",
      "",
    ];
    const { productId, leader, members } = await setupProduct({ members: names.length });
    for (const [i, m] of members.entries()) await setUserName(m.userId, names[i]!);

    const first = await listNames(productId, leader.cookie);
    expect(first.length).toBe(names.length + 1);
    expect(new Set(first.map((m) => m.productMemberId)).size).toBe(names.length + 1);
    expect(first[0]!.role).toBe("leader");
    expect(first.slice(1).map((m) => m.userName).sort()).toEqual([...names].sort());

    // 追加のたびに順序が揺れない(5 回呼んでも同じ)
    for (let i = 0; i < 5; i++) {
      const again = await listNames(productId, members[0]!.cookie);
      expect(again.map((m) => m.productMemberId)).toEqual(first.map((m) => m.productMemberId));
    }
  });

  test("挿入の順序を変えても、同じ名前の集合なら同じ名前の並びになる(順序は DB の照合順序だけで決まる)", async () => {
    const names = ["みかん", "ミカン", "蜜柑", "Mikan", "🍊", "a", "B", "c"];
    const orders: string[][] = [];
    for (const arrangement of [names, [...names].reverse()]) {
      const { productId, leader, members } = await setupProduct({ members: names.length });
      for (const [i, m] of members.entries()) await setUserName(m.userId, arrangement[i]!);
      const list = await listNames(productId, leader.cookie);
      orders.push(list.slice(1).map((m) => m.userName));
    }
    expect(orders[1]).toEqual(orders[0]!);
  });

  test("名前の大文字・小文字が混ざっても、一覧とツリー(メンバー部分)の並びが一致する", async () => {
    const { productId, leader, members } = await setupProduct({ members: 6 });
    const names = ["bob", "Alice", "alice", "Bob", "あい", "アイ"];
    for (const [i, m] of members.entries()) await setUserName(m.userId, names[i]!);

    const list = await listNames(productId, leader.cookie);
    const tree = await request("GET", `/api/product/${productId}/tree`, { cookie: leader.cookie });
    expect(tree.status).toBe(200);
    const body = (await tree.json()) as {
      members?: { productMemberId: string }[];
      leader?: { members?: { productMemberId: string }[] };
    };
    const treeMembers = body.members ?? body.leader?.members;
    expect(treeMembers).toBeDefined();
    expect(treeMembers!.map((m) => m.productMemberId)).toEqual(
      list.slice(1).map((m) => m.productMemberId)
    );
  });

  test("メンバーが 0 人(リーダーだけ)のプロダクトは、リーダー 1 人の配列を返す", async () => {
    const { productId, leader } = await setupProduct({ members: 0 });
    const list = await listNames(productId, leader.cookie);
    expect(list).toEqual([
      {
        productMemberId: leader.memberId,
        userId: leader.userId,
        userName: "leader",
        avatarUrl: null,
        role: "leader",
      },
    ]);
  });

  test("リーダーが複数いる異常なデータでも落ちず、リーダー全員が先に並ぶ", async () => {
    const { productId, leader, members } = await setupProduct({ members: 3 });
    // 異常データ: members[0] を直接リーダーに昇格させる
    const { eq } = await import("drizzle-orm");
    await db
      .update(productMembers)
      .set({ role: "leader" })
      .where(eq(productMembers.productMemberId, members[0]!.memberId));
    await setUserName(leader.userId, "zzz");
    await setUserName(members[0]!.userId, "yyy");
    await setUserName(members[1]!.userId, "aaa");
    await setUserName(members[2]!.userId, "bbb");

    const list = await listNames(productId, members[1]!.cookie);
    expect(list.map((m) => m.role)).toEqual(["leader", "leader", "member", "member"]);
    expect(list.map((m) => m.userName)).toEqual(["yyy", "zzz", "aaa", "bbb"]);
  });
});
