import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cleanup, list, makeKind, setupProduct } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let other: Ctx;
let empty: Ctx;

beforeAll(async () => {
  p = await setupProduct();
  other = await setupProduct();
  empty = await setupProduct();
});
afterAll(cleanup);

const names = async (c: Ctx, who: "leader" | "member" = "leader") => {
  const res = await list(c.productId, who === "leader" ? c.leader.cookie : c.members[0]!.cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { taskTypeName: string }[]).map((k) => k.taskTypeName);
};

describe("一覧の追加観点", () => {
  it("種類がないプロダクトは [] (null や 404 ではない)", async () => {
    const res = await list(empty.productId, empty.leader.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
  it("他のプロダクトの種類は出ない", async () => {
    await makeKind(other.productId, "他プロダクトだけの種類");
    expect(await names(p)).not.toContain("他プロダクトだけの種類");
    expect(await names(other)).toContain("他プロダクトだけの種類");
  });
  it("各要素は { taskTypeId, taskTypeName, productId } の 3 項目の文字列だけ", async () => {
    await makeKind(p.productId, "shape");
    const res = await list(p.productId, p.members[0]!.cookie);
    for (const k of (await res.json()) as Record<string, unknown>[]) {
      expect(Object.keys(k).sort()).toEqual(["productId", "taskTypeId", "taskTypeName"]);
      expect(typeof k.taskTypeId).toBe("string");
      expect(typeof k.taskTypeName).toBe("string");
      expect(k.productId).toBe(p.productId);
    }
  });
  it("メンバーとリーダーで同じ一覧", async () => {
    expect(await names(p, "member")).toEqual(await names(p, "leader"));
  });
  it("同じ並びを何度取得しても変わらない(安定)", async () => {
    const a = await names(p);
    const b = await names(p);
    expect(b).toEqual(a);
  });
});

describe("並び順", () => {
  it("英字・数字・日本語・記号が混ざっても、2 回の取得で同じ順序で、DB の返す順と一致する", async () => {
    const c = await setupProduct({ members: 1 });
    const input = ["ビルド", "テスト", "2024", "10", "Zeta", "alpha", "Beta", "_under", "-dash", "あ", "ア", "漢字", "😀"];
    for (const n of input) await makeKind(c.productId, n);
    const got = await names(c);
    expect(got.sort()).toEqual([...input].sort());
    expect(await names(c)).toEqual(await names(c));
  });
  it("同じ文字種の中では名前の昇順(英小文字 a-z)", async () => {
    const c = await setupProduct({ members: 1 });
    for (const n of ["c", "a", "b"]) await makeKind(c.productId, n);
    expect(await names(c)).toEqual(["a", "b", "c"]);
  });
  it("同じ文字種の中では名前の昇順(数字は文字列順: 1 < 10 < 2)", async () => {
    const c = await setupProduct({ members: 1 });
    for (const n of ["2", "10", "1"]) await makeKind(c.productId, n);
    expect(await names(c)).toEqual(["1", "10", "2"]);
  });
  it("日本語(ひらがな)は五十音順", async () => {
    const c = await setupProduct({ members: 1 });
    for (const n of ["さ", "あ", "か"]) await makeKind(c.productId, n);
    expect(await names(c)).toEqual(["あ", "か", "さ"]);
  });
});

describe("多数", () => {
  it("100 件の種類がすべて返る", async () => {
    const c = await setupProduct({ members: 1 });
    for (let i = 0; i < 100; i++) await makeKind(c.productId, `種類${String(i).padStart(3, "0")}`);
    const got = await names(c);
    expect(got).toHaveLength(100);
    expect(got[0]).toBe("種類000");
    expect(got[99]).toBe("種類099");
    expect(got).toEqual([...got].sort());
  });
});
