import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import { productMembers } from "../../src/db/schema";
import { memberRoutes } from "../../src/routes/member";
import { cleanup, findTask, insertTask, setupProduct } from "../task/helpers";

afterAll(cleanup);

const app = new Elysia().use(memberRoutes);

function del(productId: string, memberId: string, cookie: string) {
  return app.handle(
    new Request(`http://localhost/api/product/${productId}/member/${memberId}`, {
      method: "DELETE",
      headers: { cookie },
    })
  );
}

describe("DELETE /api/product/:productId/member/:memberId の同時実行", () => {
  test("同じメンバーを同時に 2 回削除すると、204 が 1 つ・404 が 1 つになる(5 ラウンド)", async () => {
    for (let round = 0; round < 5; round++) {
      const { productId, leader, members } = await setupProduct();
      const target = members[0]!;
      const task = await insertTask(target.memberId);

      const responses = await Promise.all([
        del(productId, target.memberId, leader.cookie),
        del(productId, target.memberId, leader.cookie),
      ]);
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([204, 404]);

      const [row] = await db
        .select()
        .from(productMembers)
        .where(eq(productMembers.productMemberId, target.memberId));
      expect(row).toBeUndefined();
      expect(await findTask(task!.taskId)).toBeUndefined();
    }
  });
});
