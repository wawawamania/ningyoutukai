import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, itemUrl, listUrl, request, setupProduct, type MemberJson } from "./helpers";

afterAll(cleanup);

describe("パスのパラメータの境界", () => {
  test("大文字の UUID でも同じメンバーを取得できる(一覧・個別とも)", async () => {
    const { productId, leader, members } = await setupProduct();
    const res = await request(
      "GET",
      itemUrl(productId.toUpperCase(), members[0]!.memberId.toUpperCase()),
      { cookie: leader.cookie }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as MemberJson).productMemberId).toBe(members[0]!.memberId);

    const list = await request("GET", listUrl(productId.toUpperCase()), { cookie: leader.cookie });
    expect(list.status).toBe(200);
    expect(((await list.json()) as MemberJson[]).length).toBe(3);
  });

  test("UUID でない memberId・前後の空白などは 422 で、日本語の message になる", async () => {
    const { productId, leader } = await setupProduct();
    const bad = [
      "abc",
      "%20" + crypto.randomUUID(),
      crypto.randomUUID() + "%20",
      crypto.randomUUID() + "x",
      crypto.randomUUID().slice(1),
      "00000000-0000-0000-0000-00000000000g",
      "null",
      "undefined",
      "1",
    ];
    for (const id of bad) {
      for (const method of ["GET", "DELETE"]) {
        const res = await request(method, itemUrl(productId, id), { cookie: leader.cookie });
        expect(res.status).toBe(422);
        const body = (await res.json()) as { message: string };
        expect(Object.keys(body)).toEqual(["message"]);
        expect(body.message).toMatch(/^入力が正しくありません/);
        expect(body.message).toContain("memberId");
      }
    }
  });

  test("UUID でない productId は 422(個別取得・削除も)", async () => {
    const { leader, members } = await setupProduct();
    for (const method of ["GET", "DELETE"]) {
      const res = await request(method, itemUrl("not-a-uuid", members[0]!.memberId), {
        cookie: leader.cookie,
      });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { message: string }).message).toContain("productId");
    }
  });

  test("認証のないリクエストの本文は、日本語の { message } だけになる", async () => {
    const res = await request("GET", itemUrl("abc", "def"));
    expect([401, 422]).toContain(res.status);
    const body = (await res.json()) as { message: string };
    expect(Object.keys(body)).toEqual(["message"]);
    expect(body.message).toMatch(/[ぁ-んァ-ン]/);
  });

  test("memberId に userId を渡しても 404、productId に memberId を渡しても 404", async () => {
    const { productId, leader, members } = await setupProduct();
    const res = await request("GET", itemUrl(productId, members[0]!.userId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "メンバーが見つかりません" });

    const res2 = await request("GET", listUrl(leader.memberId), { cookie: leader.cookie });
    expect(res2.status).toBe(404);
    expect(await res2.json()).toEqual({ message: "プロダクトが見つかりません" });
  });

  test("userId を memberId に渡して削除しようとしても何も起きない(404)", async () => {
    const { productId, leader, members } = await setupProduct();
    const res = await request("DELETE", itemUrl(productId, members[0]!.userId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(404);
    const list = await request("GET", listUrl(productId), { cookie: leader.cookie });
    expect(((await list.json()) as MemberJson[]).length).toBe(3);
  });

  test("クエリ文字列が付いていても無視される", async () => {
    const { productId, leader, members } = await setupProduct();
    const res = await request(
      "GET",
      `${itemUrl(productId, members[0]!.memberId)}?role=leader&x=1`,
      { cookie: leader.cookie }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as MemberJson).role).toBe("member");
  });

  test("サポートしていないメソッドは 404 か 405 で、メンバーは変わらない", async () => {
    const { productId, leader, members } = await setupProduct();
    for (const method of ["PUT", "PATCH", "POST"]) {
      const res = await request(method, itemUrl(productId, members[0]!.memberId), {
        cookie: leader.cookie,
      });
      expect([404, 405]).toContain(res.status);
      const body = (await res.json()) as { message?: string };
      if (body.message !== undefined) expect(body.message).toMatch(/[ぁ-んァ-ン]/);
    }
    const list = await request("GET", listUrl(productId), { cookie: leader.cookie });
    expect(((await list.json()) as MemberJson[]).length).toBe(3);
  });

  test("壊れた cookie・存在しないセッションは 401", async () => {
    const { productId, members } = await setupProduct();
    const cookies = ["better-auth.session_token=garbage", "foo=bar", "better-auth.session_token="];
    for (const cookie of cookies) {
      const res = await request("DELETE", itemUrl(productId, members[0]!.memberId), { cookie });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ message: "ログインが必要です" });
    }
  });
});
