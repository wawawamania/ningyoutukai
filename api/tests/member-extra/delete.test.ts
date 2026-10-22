import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { productMembers, taskTypes, tasks, users } from "../../src/db/schema";
import {
  cleanup,
  countTasks,
  createTaskType,
  findTask,
  insertTask,
  itemUrl,
  listUrl,
  memberExists,
  request,
  setupProduct,
  type MemberJson,
} from "./helpers";

afterAll(cleanup);

type TreeJson = {
  leader: { productMemberId: string; tasks?: { taskId: string }[] } | null;
  members: { productMemberId: string; tasks?: { taskId: string }[] }[];
};

describe("メンバー削除の副作用", () => {
  test("そのメンバーのタスクだけが消える(完了済み・非表示・種類つき・報告済みも含む)。ほかは残る", async () => {
    const { productId, leader, members } = await setupProduct({ members: 3 });
    const type = await createTaskType(productId);
    const now = new Date();
    const gone = [
      await insertTask(members[0]!.memberId),
      await insertTask(members[0]!.memberId, { isVisible: false }),
      await insertTask(members[0]!.memberId, { completedAt: now, reportedAt: now }),
      await insertTask(members[0]!.memberId, { taskTypeId: type!.taskTypeId, timeLimit: now }),
    ];
    const kept = [
      await insertTask(leader.memberId),
      await insertTask(members[1]!.memberId),
      await insertTask(members[2]!.memberId, { completedAt: now }),
    ];

    const res = await request("DELETE", itemUrl(productId, members[0]!.memberId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(204);

    for (const t of gone) expect(await findTask(t!.taskId)).toBeUndefined();
    for (const t of kept) expect(await findTask(t!.taskId)).toBeDefined();
    expect(await countTasks(productId)).toBe(3);

    // タスクの種類は残る(タスクを消しても種類は消えない)
    const [typeRow] = await db.select().from(taskTypes).where(eq(taskTypes.taskTypeId, type!.taskTypeId));
    expect(typeRow).toBeDefined();
  });

  test("削除してもユーザー本人(users の行)は残り、他のプロダクトへの所属も残る", async () => {
    const a = await setupProduct();
    const b = await setupProduct();
    const victim = a.members[0]!;
    await db.insert(productMembers).values({ productId: b.productId, userId: victim.userId, role: "member" });
    const otherTask = await insertTask(
      (
        await db
          .select()
          .from(productMembers)
          .where(eq(productMembers.productId, b.productId))
      ).find((m) => m.userId === victim.userId)!.productMemberId
    );

    const res = await request("DELETE", itemUrl(a.productId, victim.memberId), { cookie: a.leader.cookie });
    expect(res.status).toBe(204);

    const [user] = await db.select().from(users).where(eq(users.userId, victim.userId));
    expect(user).toBeDefined();
    // 他のプロダクトの所属・タスクは変わらない
    const list = await request("GET", listUrl(b.productId), { cookie: b.leader.cookie });
    expect(((await list.json()) as MemberJson[]).some((m) => m.userId === victim.userId)).toBe(true);
    expect(await findTask(otherTask!.taskId)).toBeDefined();
    // 削除された人は、他のプロダクトにはまだログインして入れる
    expect((await request("GET", listUrl(b.productId), { cookie: victim.cookie })).status).toBe(200);
    expect((await request("GET", listUrl(a.productId), { cookie: victim.cookie })).status).toBe(404);
  });

  test("失敗した削除(403・404・409・422)では、メンバーもタスクも変わらない", async () => {
    const { productId, leader, members } = await setupProduct();
    const t1 = await insertTask(members[0]!.memberId);
    const t2 = await insertTask(leader.memberId);
    const attempts: [string, string | undefined, number][] = [
      [itemUrl(productId, members[0]!.memberId), members[1]!.cookie, 403],
      [itemUrl(productId, crypto.randomUUID()), leader.cookie, 404],
      [itemUrl(productId, leader.memberId), leader.cookie, 409],
      [itemUrl(productId, "abc"), leader.cookie, 422],
      [itemUrl(productId, members[0]!.memberId), undefined, 401],
    ];
    for (const [url, cookie, status] of attempts) {
      const res = await request("DELETE", url, { cookie });
      expect(res.status).toBe(status);
    }
    expect(await findTask(t1!.taskId)).toBeDefined();
    expect(await findTask(t2!.taskId)).toBeDefined();
    expect(await countTasks(productId)).toBe(2);
    const list = await request("GET", listUrl(productId), { cookie: leader.cookie });
    expect(((await list.json()) as MemberJson[]).length).toBe(3);
  });

  test("リーダーが複数いる異常データでも、リーダーの削除は 409 で、メンバーの削除はできる", async () => {
    const { productId, leader, members } = await setupProduct();
    await db
      .update(productMembers)
      .set({ role: "leader" })
      .where(eq(productMembers.productMemberId, members[0]!.memberId));
    const t = await insertTask(members[0]!.memberId);

    const res = await request("DELETE", itemUrl(productId, members[0]!.memberId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(409);
    expect(await findTask(t!.taskId)).toBeDefined();

    const ok = await request("DELETE", itemUrl(productId, members[1]!.memberId), {
      cookie: members[0]!.cookie, // 昇格した側(リーダー)が消せる
    });
    expect(ok.status).toBe(204);
  });

  test("削除後、ツリーからメンバー(とそのタスク)が消え、残りは変わらない", async () => {
    const { productId, leader, members } = await setupProduct();
    const gone = await insertTask(members[0]!.memberId);
    const kept = await insertTask(members[1]!.memberId);
    const before = await request("GET", `/api/product/${productId}/tree`, { cookie: leader.cookie });
    const beforeBody = (await before.json()) as TreeJson;
    expect(beforeBody.members.length).toBe(2);

    const res = await request("DELETE", itemUrl(productId, members[0]!.memberId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(204);

    const after = await request("GET", `/api/product/${productId}/tree`, { cookie: leader.cookie });
    expect(after.status).toBe(200);
    const body = (await after.json()) as TreeJson;
    expect(body.members.map((m) => m.productMemberId)).toEqual([members[1]!.memberId]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(gone!.taskId);
    expect(text).not.toContain(members[0]!.memberId);
    expect(text).toContain(kept!.taskId);
    expect(body.leader?.productMemberId).toBe(leader.memberId);
  });

  test("削除したメンバーの memberId で GET すると 404(メンバーが見つかりません)", async () => {
    const { productId, leader, members } = await setupProduct();
    await request("DELETE", itemUrl(productId, members[0]!.memberId), { cookie: leader.cookie });
    const res = await request("GET", itemUrl(productId, members[0]!.memberId), {
      cookie: leader.cookie,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "メンバーが見つかりません" });
  });
});

describe("二重実行・同時実行", () => {
  test("同じメンバーを順番に 2 回削除すると、2 回目は 404", async () => {
    const { productId, leader, members } = await setupProduct();
    const first = await request("DELETE", itemUrl(productId, members[0]!.memberId), {
      cookie: leader.cookie,
    });
    const second = await request("DELETE", itemUrl(productId, members[0]!.memberId), {
      cookie: leader.cookie,
    });
    expect([first.status, second.status]).toEqual([204, 404]);
    expect(await second.json()).toEqual({ message: "メンバーが見つかりません" });
  });

  test("同じメンバーを同時に 2 回削除しても、500 にならず、データが壊れない", async () => {
    for (let round = 0; round < 5; round++) {
      const { productId, leader, members } = await setupProduct();
      const task = await insertTask(members[0]!.memberId);
      const keep = await insertTask(members[1]!.memberId);
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          request("DELETE", itemUrl(productId, members[0]!.memberId), { cookie: leader.cookie })
        )
      );
      const statuses = results.map((r) => r.status);
      for (const s of statuses) expect([204, 404]).toContain(s);
      expect(statuses).toContain(204);
      expect(await memberExists(members[0]!.memberId)).toBe(false);
      expect(await findTask(task!.taskId)).toBeUndefined();
      expect(await findTask(keep!.taskId)).toBeDefined();
      expect(await memberExists(members[1]!.memberId)).toBe(true);
    }
  });

  test("別々のメンバーを同時に削除すると、どちらも 204 で消える", async () => {
    const { productId, leader, members } = await setupProduct({ members: 4 });
    const tasksOf = await Promise.all(members.map((m) => insertTask(m.memberId)));
    const res = await Promise.all(
      [members[0]!, members[1]!].map((m) =>
        request("DELETE", itemUrl(productId, m.memberId), { cookie: leader.cookie })
      )
    );
    expect(res.map((r) => r.status)).toEqual([204, 204]);
    expect(await findTask(tasksOf[0]!.taskId)).toBeUndefined();
    expect(await findTask(tasksOf[1]!.taskId)).toBeUndefined();
    expect(await findTask(tasksOf[2]!.taskId)).toBeDefined();
    expect(await findTask(tasksOf[3]!.taskId)).toBeDefined();
    const list = await request("GET", listUrl(productId), { cookie: leader.cookie });
    expect(((await list.json()) as MemberJson[]).length).toBe(3);
  });

  test("削除と同時にタスクを追加されても、孤児のタスクが残らない(外部キーで守られる)", async () => {
    const { productId, leader, members } = await setupProduct();
    const racers = await Promise.allSettled([
      request("DELETE", itemUrl(productId, members[0]!.memberId), { cookie: leader.cookie }),
      insertTask(members[0]!.memberId),
      insertTask(members[0]!.memberId),
    ]);
    expect(racers[0]!.status).toBe("fulfilled");
    const rows = await db.select().from(tasks).where(eq(tasks.productMemberId, members[0]!.memberId));
    expect(rows.length).toBe(0);
  });
});
