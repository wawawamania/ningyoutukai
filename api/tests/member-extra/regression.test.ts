import { afterAll, expect, test } from "bun:test";
import { cleanup, itemUrl, request, setupProduct } from "./helpers";

afterAll(cleanup);

/** 直した不具合の回帰テスト。 */

// 以前は、順番に 2 回消すと 2 回目は 404 だが、同時に 2 回消すと両方 204 になることが多かった。
// delete-member.ts が削除件数(0 件なら 404)を見るようになって解消。
test("同じメンバーを同時に 2 回削除したとき、204 は 1 回だけで、もう一方は 404 になる", async () => {
  for (let round = 0; round < 6; round++) {
    const { productId, leader, members } = await setupProduct();
    const results = await Promise.all(
      [0, 1].map(() =>
        request("DELETE", itemUrl(productId, members[0]!.memberId), { cookie: leader.cookie })
      )
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
  }
});
