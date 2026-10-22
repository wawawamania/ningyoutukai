import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import { productMembers, users } from "../../src/db/schema";
import { memberRoutes } from "../../src/routes/member";
import { productRoutes } from "../../src/routes/product";
import {
  cleanup,
  countTasks,
  createOutsider,
  findTask,
  insertTask,
  setupProduct,
} from "../task/helpers";

afterAll(cleanup);

const app = new Elysia().use(memberRoutes).use(productRoutes);

function request(method: string, path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return app.handle(new Request(`http://localhost${path}`, { method, headers }));
}

const listUrl = (productId: string) => `/api/product/${productId}/member`;
const itemUrl = (productId: string, memberId: string) =>
  `/api/product/${productId}/member/${memberId}`;

type MemberJson = {
  productMemberId: string;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  role: string;
};

describe("GET /api/product/:productId/member", () => {
  test("cookie なしは 401", async () => {
    const { productId } = await setupProduct();
    const res = await request("GET", listUrl(productId));
    expect(res.status).toBe(401);
  });

  test("所属していないユーザー・存在しないプロダクトは 404", async () => {
    const { productId, leader } = await setupProduct();
    const outsider = await createOutsider();
    const res = await request("GET", listUrl(productId), outsider.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });

    const res2 = await request("GET", listUrl(crypto.randomUUID()), leader.cookie);
    expect(res2.status).toBe(404);
  });

  test("UUID でない productId は 422", async () => {
    const { leader } = await setupProduct();
    const res = await request("GET", listUrl("abc"), leader.cookie);
    expect(res.status).toBe(422);
  });

  test("リーダーもメンバーも一覧を見られ、連絡先は含まれない", async () => {
    const { productId, leader, members } = await setupProduct();
    for (const viewer of [leader, members[0]!]) {
      const res = await request("GET", listUrl(productId), viewer.cookie);
      expect(res.status).toBe(200);
      const list = (await res.json()) as MemberJson[];
      expect(list.length).toBe(3);
      for (const m of list) {
        expect(Object.keys(m).sort()).toEqual(
          ["avatarUrl", "productMemberId", "role", "userId", "userName"]
        );
        expect(JSON.stringify(m)).not.toContain("@example.com");
      }
    }
  });

  test("並び順はリーダーが先、次に名前順", async () => {
    const { productId, leader, members } = await setupProduct({ members: 3 });
    // 名前を逆順にして、名前順で並ぶことを確かめる(リーダー名は最後でもリーダーが先)
    const names = ["zeta", "alpha", "mid"];
    for (const [i, m] of members.entries()) {
      await db.update(users).set({ userName: names[i]! }).where(eq(users.userId, m.userId));
    }
    await db.update(users).set({ userName: "zzz-leader" }).where(eq(users.userId, leader.userId));

    const res = await request("GET", listUrl(productId), members[0]!.cookie);
    const list = (await res.json()) as MemberJson[];
    expect(list.map((m) => m.userName)).toEqual(["zzz-leader", "alpha", "mid", "zeta"]);
    expect(list[0]!.role).toBe("leader");
  });

  test("他のプロダクトのメンバーは含まれない", async () => {
    const a = await setupProduct({ members: 1 });
    const b = await setupProduct({ members: 2 });
    const res = await request("GET", listUrl(a.productId), a.leader.cookie);
    const list = (await res.json()) as MemberJson[];
    expect(list.map((m) => m.productMemberId).sort()).toEqual(
      [a.leader.memberId, a.members[0]!.memberId].sort()
    );
    expect(list.some((m) => m.productMemberId === b.leader.memberId)).toBe(false);
  });
});

describe("GET /api/product/:productId/member/:memberId", () => {
  test("cookie なしは 401", async () => {
    const { productId, members } = await setupProduct();
    const res = await request("GET", itemUrl(productId, members[0]!.memberId));
    expect(res.status).toBe(401);
  });

  test("所属していないユーザーは 404", async () => {
    const { productId, members } = await setupProduct();
    const outsider = await createOutsider();
    const res = await request("GET", itemUrl(productId, members[0]!.memberId), outsider.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "プロダクトが見つかりません" });
  });

  test("メンバーの情報を取得できる(メンバー本人・リーダーのどちらからも)", async () => {
    const { productId, leader, members } = await setupProduct();
    for (const viewer of [leader, members[1]!]) {
      const res = await request("GET", itemUrl(productId, members[0]!.memberId), viewer.cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        productMemberId: members[0]!.memberId,
        userId: members[0]!.userId,
        userName: "member1",
        avatarUrl: null,
        role: "member",
      });
    }
    const res = await request("GET", itemUrl(productId, leader.memberId), members[0]!.cookie);
    expect(((await res.json()) as MemberJson).role).toBe("leader");
  });

  test("存在しない memberId・他のプロダクトのメンバー・userId は 404、UUID でなければ 422", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    const cases = [crypto.randomUUID(), b.members[0]!.memberId, a.members[0]!.userId];
    for (const id of cases) {
      const res = await request("GET", itemUrl(a.productId, id), a.leader.cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "メンバーが見つかりません" });
    }
    const res = await request("GET", itemUrl(a.productId, "abc"), a.leader.cookie);
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/product/:productId/member/:memberId", () => {
  test("cookie なしは 401", async () => {
    const { productId, members } = await setupProduct();
    const res = await request("DELETE", itemUrl(productId, members[0]!.memberId));
    expect(res.status).toBe(401);
  });

  test("所属していないユーザーは 404", async () => {
    const { productId, members } = await setupProduct();
    const outsider = await createOutsider();
    const res = await request("DELETE", itemUrl(productId, members[0]!.memberId), outsider.cookie);
    expect(res.status).toBe(404);
  });

  test("メンバーは削除できない(403)", async () => {
    const { productId, members } = await setupProduct();
    const res = await request("DELETE", itemUrl(productId, members[1]!.memberId), members[0]!.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "プロダクトリーダーのみ実行できます" });
    const list = await request("GET", listUrl(productId), members[0]!.cookie);
    expect(((await list.json()) as MemberJson[]).length).toBe(3);
  });

  test("リーダー自身は削除できない(409)", async () => {
    const { productId, leader } = await setupProduct();
    const res = await request("DELETE", itemUrl(productId, leader.memberId), leader.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "リーダーは削除できません" });
    const [row] = await db
      .select()
      .from(productMembers)
      .where(eq(productMembers.productMemberId, leader.memberId));
    expect(row).toBeDefined();
  });

  test("存在しない memberId・他のプロダクトのメンバーは 404 で、何も消えない", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    const task = await insertTask(b.members[0]!.memberId);
    for (const id of [crypto.randomUUID(), b.members[0]!.memberId]) {
      const res = await request("DELETE", itemUrl(a.productId, id), a.leader.cookie);
      expect(res.status).toBe(404);
    }
    expect(await findTask(task.taskId)).toBeDefined();
    const res = await request("DELETE", itemUrl(a.productId, "abc"), a.leader.cookie);
    expect(res.status).toBe(422);
  });

  test("リーダーが削除すると 204。そのメンバーのタスクだけ消え、一覧とプロダクト一覧からも消える", async () => {
    const { productId, leader, members } = await setupProduct();
    const other = await setupProduct();
    const t1 = await insertTask(members[0]!.memberId);
    const t2 = await insertTask(members[0]!.memberId, { isVisible: false });
    const keep1 = await insertTask(members[1]!.memberId);
    const keep2 = await insertTask(leader.memberId);
    const otherTask = await insertTask(other.members[0]!.memberId);

    const res = await request("DELETE", itemUrl(productId, members[0]!.memberId), leader.cookie);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    expect(await findTask(t1.taskId)).toBeUndefined();
    expect(await findTask(t2.taskId)).toBeUndefined();
    expect(await findTask(keep1.taskId)).toBeDefined();
    expect(await findTask(keep2.taskId)).toBeDefined();
    expect(await findTask(otherTask.taskId)).toBeDefined();
    expect(await countTasks(productId)).toBe(2);
    expect(await countTasks(other.productId)).toBe(1);

    // 一覧から消える。他のプロダクトのメンバーは残る
    const list = await request("GET", listUrl(productId), leader.cookie);
    const ids = ((await list.json()) as MemberJson[]).map((m) => m.productMemberId);
    expect(ids.sort()).toEqual([leader.memberId, members[1]!.memberId].sort());
    const otherList = await request("GET", listUrl(other.productId), other.leader.cookie);
    expect(((await otherList.json()) as MemberJson[]).length).toBe(3);

    // 個別取得は 404
    const get = await request("GET", itemUrl(productId, members[0]!.memberId), leader.cookie);
    expect(get.status).toBe(404);

    // 削除された人は、そのプロダクトを見られない
    const gone = await request("GET", listUrl(productId), members[0]!.cookie);
    expect(gone.status).toBe(404);
    const products = await request("GET", "/api/product", members[0]!.cookie);
    expect(products.status).toBe(200);
    const productList = (await products.json()) as { productId: string }[];
    expect(productList.some((p) => p.productId === productId)).toBe(false);

    // 二重削除は 404
    const again = await request("DELETE", itemUrl(productId, members[0]!.memberId), leader.cookie);
    expect(again.status).toBe(404);
  });
});
