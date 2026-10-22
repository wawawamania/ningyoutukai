import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { productMembers } from "../../src/db/schema";
import { cleanup, createOutsider, setupProduct } from "../task/helpers";
import { call, del, get, patch } from "./helpers";

afterAll(cleanup);

const NOT_FOUND = { message: "プロダクトが見つかりません" };
const LEADER_ONLY = { message: "プロダクトリーダーのみ実行できます" };

describe("権限の行列(PATCH / DELETE)", () => {
  test("認証なし・不正な cookie は 401 で { message } 、データは変わらない", async () => {
    const { productId, leader } = await setupProduct();
    const before = await (await get(productId, leader.cookie)).json();
    for (const cookie of [undefined, "better-auth.session_token=invalid"]) {
      const p = await patch(productId, cookie, { productName: "x" });
      expect(p.status).toBe(401);
      expect(await p.json()).toEqual({ message: "ログインが必要です" });
      const d = await del(productId, cookie);
      expect(d.status).toBe(401);
      expect(await d.json()).toEqual({ message: "ログインが必要です" });
    }
    expect(await (await get(productId, leader.cookie)).json()).toEqual(before);
  });

  test("所属していない人: PATCH / DELETE とも 404 で、存在しない ID と同じ本文", async () => {
    const { productId, leader } = await setupProduct();
    const outsider = await createOutsider();
    const before = await (await get(productId, leader.cookie)).json();
    const p = await patch(productId, outsider.cookie, { productName: "x" });
    const d = await del(productId, outsider.cookie);
    const pMissing = await patch(crypto.randomUUID(), outsider.cookie, { productName: "x" });
    expect(p.status).toBe(404);
    expect(d.status).toBe(404);
    expect(await p.json()).toEqual(NOT_FOUND);
    expect(await d.json()).toEqual(NOT_FOUND);
    expect(await pMissing.json()).toEqual(NOT_FOUND);
    expect(await (await get(productId, leader.cookie)).json()).toEqual(before);
  });

  test("メンバー: PATCH / DELETE とも 403 で { message }、データは変わらない", async () => {
    const { productId, leader, members } = await setupProduct();
    const before = await (await get(productId, leader.cookie)).json();
    for (const m of members) {
      const p = await patch(productId, m.cookie, { productName: "x" });
      const d = await del(productId, m.cookie);
      expect(p.status).toBe(403);
      expect(d.status).toBe(403);
      expect(await p.json()).toEqual(LEADER_ONLY);
      expect(await d.json()).toEqual(LEADER_ONLY);
    }
    expect(await (await get(productId, leader.cookie)).json()).toEqual(before);
  });

  test("メンバーが空白だけの名前を送っても、権限チェックが先で 403", async () => {
    const { productId, members } = await setupProduct();
    const res = await patch(productId, members[0].cookie, { productName: "   " });
    expect(res.status).toBe(403);
  });

  test("所属していない人が空の名前を送っても 404(存在を漏らさない)", async () => {
    const { productId } = await setupProduct();
    const outsider = await createOutsider();
    const res = await patch(productId, outsider.cookie, { productName: "  " });
    expect(res.status).toBe(404);
  });

  test("リーダーが 2 人いても、どちらも変更・削除できる", async () => {
    const { productId, leader, members } = await setupProduct();
    await db
      .update(productMembers)
      .set({ role: "leader" })
      .where(eq(productMembers.productMemberId, members[0].memberId));
    expect((await patch(productId, members[0].cookie, { productName: "二人目" })).status).toBe(200);
    expect((await patch(productId, leader.cookie, { productName: "一人目" })).status).toBe(200);
    expect((await del(productId, members[0].cookie)).status).toBe(204);
  });

  test("リーダーからメンバーに降格すると、その時点から 403 になる", async () => {
    const { productId, leader } = await setupProduct();
    await db
      .update(productMembers)
      .set({ role: "member" })
      .where(eq(productMembers.productMemberId, leader.memberId));
    expect((await patch(productId, leader.cookie, { productName: "x" })).status).toBe(403);
    expect((await del(productId, leader.cookie)).status).toBe(403);
  });

  test("メンバーから外された(行が削除された)人は 404", async () => {
    const { productId, leader, members } = await setupProduct();
    await db
      .delete(productMembers)
      .where(
        and(
          eq(productMembers.productId, productId),
          eq(productMembers.productMemberId, members[0].memberId)
        )
      );
    expect((await patch(productId, members[0].cookie, { productName: "x" })).status).toBe(404);
    expect((await del(productId, members[0].cookie)).status).toBe(404);
    expect((await get(productId, leader.cookie)).status).toBe(200);
  });

  test("リーダーが外された場合も、元リーダーは 404 になる", async () => {
    const { productId, leader } = await setupProduct();
    await db
      .delete(productMembers)
      .where(eq(productMembers.productMemberId, leader.memberId));
    expect((await patch(productId, leader.cookie, { productName: "x" })).status).toBe(404);
    expect((await del(productId, leader.cookie)).status).toBe(404);
  });

  test("別のプロダクトのリーダーは、自分のプロダクトでは権限があっても他方は 404", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    const beforeB = await (await get(b.productId, b.leader.cookie)).json();
    const p = await patch(b.productId, a.leader.cookie, { productName: "他人" });
    const d = await del(b.productId, a.leader.cookie);
    expect(p.status).toBe(404);
    expect(d.status).toBe(404);
    expect(await (await get(b.productId, b.leader.cookie)).json()).toEqual(beforeB);
    expect((await get(a.productId, a.leader.cookie)).status).toBe(200);
  });

  test("あるプロダクトのリーダーで、別のプロダクトではメンバーなら 403", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    // a のリーダーを b のメンバーとして参加させる
    await db
      .insert(productMembers)
      .values({ productId: b.productId, userId: a.leader.userId, role: "member" });
    expect((await patch(b.productId, a.leader.cookie, { productName: "x" })).status).toBe(403);
    expect((await del(b.productId, a.leader.cookie)).status).toBe(403);
    expect((await patch(a.productId, a.leader.cookie, { productName: "自分の" })).status).toBe(200);
  });
});

describe("パスの productId", () => {
  test("大文字の UUID は受け付けられる(PostgreSQL の uuid は大文字小文字を区別しない)", async () => {
    const { productId, leader } = await setupProduct();
    const res = await patch(productId.toUpperCase(), leader.cookie, { productName: "大文字" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.productId).toBe(productId);
    expect((await del(productId.toUpperCase(), leader.cookie)).status).toBe(204);
  });

  test("UUID でない値・前後の空白・末尾の文字は 422 で { message }", async () => {
    const { productId, leader } = await setupProduct();
    for (const id of [
      "abc",
      "%20" + productId,
      productId + "%20",
      productId + "x",
      productId.replace(/-/g, ""),
      "00000000-0000-0000-0000-00000000000g",
    ]) {
      const p = await call("PATCH", `/api/product/${id}`, {
        cookie: leader.cookie,
        body: { productName: "x" },
      });
      const d = await call("DELETE", `/api/product/${id}`, { cookie: leader.cookie });
      expect(p.status).toBe(422);
      expect(d.status).toBe(422);
      expect(typeof (await p.json()).message).toBe("string");
    }
    expect((await get(productId, leader.cookie)).status).toBe(200);
  });

  test("ゼロ UUID(存在しない)は 404", async () => {
    const outsider = await createOutsider();
    const id = "00000000-0000-0000-0000-000000000000";
    expect((await patch(id, outsider.cookie, { productName: "x" })).status).toBe(404);
    expect((await del(id, outsider.cookie)).status).toBe(404);
  });
});
