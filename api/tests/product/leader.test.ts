import { afterAll, describe, expect, test } from "bun:test";
import { cleanup, createProduct, createTestUser, findAppUsers, findMembers } from "./helpers";

afterAll(cleanup);

describe("作成者のリーダー登録", () => {
  test("作成者が role=leader で product_members に入る", async () => {
    const user = await createTestUser();
    const res = await createProduct(user.cookie, { productName: "リーダー確認" });
    const { productId } = await res.json();

    const [appUser] = await findAppUsers(user.email);
    const members = await findMembers(productId);
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(appUser!.userId);
    expect(members[0]!.role).toBe("leader");
  });
});
