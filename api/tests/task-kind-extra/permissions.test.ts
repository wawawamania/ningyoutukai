import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  cleanup,
  createOutsider,
  del,
  kindName,
  kindNames,
  list,
  makeKind,
  patch,
  post,
  removeMember,
  setupProduct,
} from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let outsider: Awaited<ReturnType<typeof createOutsider>>;
let kindId: string;

beforeAll(async () => {
  p = await setupProduct({ members: 3 });
  outsider = await createOutsider();
  kindId = await makeKind(p.productId, "既存の種類");
  // members[2] はプロダクトから外す(削除済みのメンバー)。cookie は有効なまま
  await removeMember(p.members[2]!.memberId);
});
afterAll(cleanup);

const NOT_FOUND = { message: "プロダクトが見つかりません" };
const FORBIDDEN = { message: "プロダクトリーダーのみ実行できます" };
const UNAUTH = { message: "ログインが必要です" };

type Who = "なし" | "所属外" | "削除済みメンバー" | "メンバー" | "リーダー";
const cookieOf = (who: Who) =>
  ({
    なし: undefined,
    所属外: outsider.cookie,
    削除済みメンバー: p.members[2]!.cookie,
    メンバー: p.members[0]!.cookie,
    リーダー: p.leader.cookie,
  })[who];

// 書き込み系(リーダーだけ)の期待
const writeExpect: Record<Who, [number, unknown]> = {
  なし: [401, UNAUTH],
  所属外: [404, NOT_FOUND],
  削除済みメンバー: [404, NOT_FOUND],
  メンバー: [403, FORBIDDEN],
  リーダー: [-1, null],
};

describe("権限の表(行列)", () => {
  for (const who of ["なし", "所属外", "削除済みメンバー", "メンバー"] as Who[]) {
    const [status, msg] = writeExpect[who];
    it(`POST: ${who} は ${status}`, async () => {
      const before = (await kindNames(p.productId)).length;
      const res = await post(p.productId, cookieOf(who), { taskTypeName: `post-${who}` });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(msg);
      expect((await kindNames(p.productId)).length).toBe(before);
    });
    it(`PATCH: ${who} は ${status}`, async () => {
      const res = await patch(p.productId, kindId, cookieOf(who), { taskTypeName: `patch-${who}` });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(msg);
      expect(await kindName(kindId)).toBe("既存の種類");
    });
    it(`DELETE: ${who} は ${status}`, async () => {
      const res = await del(p.productId, kindId, cookieOf(who));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(msg);
      expect(await kindName(kindId)).toBe("既存の種類");
    });
  }

  const readExpect: Record<Who, number> = {
    なし: 401,
    所属外: 404,
    削除済みメンバー: 404,
    メンバー: 200,
    リーダー: 200,
  };
  for (const who of Object.keys(readExpect) as Who[]) {
    it(`GET: ${who} は ${readExpect[who]}`, async () => {
      const res = await list(p.productId, cookieOf(who));
      expect(res.status).toBe(readExpect[who]);
      const json = await res.json();
      if (res.status === 200) expect(Array.isArray(json)).toBe(true);
      else expect(Object.keys(json)).toEqual(["message"]);
    });
  }
});

describe("判定の順序(認証 → 所属 → リーダー権限 → 入力 → 同名)", () => {
  it("メンバーが空の名前を送っても 403(400 ではない)", async () => {
    const res = await post(p.productId, p.members[0]!.cookie, { taskTypeName: "  " });
    expect(res.status).toBe(403);
  });
  it("所属外が空の名前を送っても 404", async () => {
    expect((await post(p.productId, outsider.cookie, { taskTypeName: "" })).status).toBe(404);
  });
  // Elysia はスキーマ検証を resolve(認証)より先に行うため、型が違う本文は未ログインでも 422 になる。
  // 情報は漏れない(本文の形式だけ)が、「認証が最初」ではないことを記録する。
  it("未ログインが型の違う本文を送ると 422(スキーマ検証は認証より先)", async () => {
    const res = await post(p.productId, undefined, { taskTypeName: 123 });
    expect(res.status).toBe(422);
  });
  it("未ログインが正しい形の本文を送ると 401", async () => {
    const res = await post(p.productId, undefined, { taskTypeName: "" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTH);
  });
  it("メンバーが長すぎる名前を送ると 422(スキーマ検証は権限より先)", async () => {
    const res = await post(p.productId, p.members[0]!.cookie, { taskTypeName: "x".repeat(51) });
    expect(res.status).toBe(422);
  });
  it("メンバーが同名を送っても 403(409 ではない)", async () => {
    const res = await post(p.productId, p.members[0]!.cookie, { taskTypeName: "既存の種類" });
    expect(res.status).toBe(403);
  });
  it("リーダーが空の名前 → 400、同名 → 409 の順で、400 が先", async () => {
    expect((await post(p.productId, p.leader.cookie, { taskTypeName: " " })).status).toBe(400);
    expect((await post(p.productId, p.leader.cookie, { taskTypeName: "既存の種類" })).status).toBe(409);
  });
  it("存在しない種類へのメンバーの PATCH は 403(種類の存在は権限の後)", async () => {
    const res = await patch(p.productId, crypto.randomUUID(), p.members[0]!.cookie, { taskTypeName: "x" });
    expect(res.status).toBe(403);
  });
  it("存在しない種類へのリーダーの空名 PATCH は 400(種類の存在確認より前)", async () => {
    const res = await patch(p.productId, crypto.randomUUID(), p.leader.cookie, { taskTypeName: " " });
    expect(res.status).toBe(400);
  });
  it("存在しないプロダクトは、リーダーの cookie でも 404", async () => {
    const res = await del(crypto.randomUUID(), kindId, p.leader.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
  });
});

describe("エラー本文の形式", () => {
  it("422・404・403・401・409 がすべて { message: 日本語 } の形", async () => {
    const calls = [
      post("zzz", p.leader.cookie, { taskTypeName: "x" }),
      post(p.productId, outsider.cookie, { taskTypeName: "x" }),
      post(p.productId, p.members[0]!.cookie, { taskTypeName: "x" }),
      post(p.productId, undefined, { taskTypeName: "x" }),
      post(p.productId, p.leader.cookie, { taskTypeName: "既存の種類" }),
      patch(p.productId, "zzz", p.leader.cookie, { taskTypeName: "x" }),
      del(p.productId, "zzz", p.leader.cookie),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const json = await res.json();
      expect(Object.keys(json)).toEqual(["message"]);
      // 日本語を含み、生の英語の文ではない
      expect(json.message).toMatch(/[぀-ヿ一-鿿]/);
    }
  });
  it("422 は「入力が正しくありません: 項目」の形で、複数項目は「、」区切り", async () => {
    const r1 = await patch("a", "b", p.leader.cookie, { taskTypeName: "x" });
    expect(r1.status).toBe(422);
    const m = (await r1.json()).message as string;
    expect(m).toStartWith("入力が正しくありません: ");
    expect(m).toContain("productId");
    expect(m).toContain("kindId");
  });
});
