import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cleanup, kindName, kindNames, makeKind, patch, post, setupProduct } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
let other: Ctx;

beforeAll(async () => {
  p = await setupProduct();
  other = await setupProduct();
});
afterAll(cleanup);

const create = (body: unknown, c: Ctx = p) => post(c.productId, c.leader.cookie, body);
const uniq = (s: string) => `${s}-${crypto.randomUUID().slice(0, 8)}`;

describe("同名の判定(追加)", () => {
  it("前後の空白だけが違う名前は同名として 409", async () => {
    const name = uniq("trim");
    expect((await create({ taskTypeName: name })).status).toBe(201);
    for (const v of [` ${name}`, `${name} `, `　${name}\t`]) {
      const res = await create({ taskTypeName: v });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ message: "同じ名前のタスクの種類がすでにあります" });
    }
  });
  it("大文字・小文字は別の名前として扱われる(DB の一意制約は区別する)", async () => {
    const base = uniq("Design");
    expect((await create({ taskTypeName: base })).status).toBe(201);
    expect((await create({ taskTypeName: base.toLowerCase() })).status).toBe(201);
    expect((await create({ taskTypeName: base.toUpperCase() })).status).toBe(201);
  });
  it("全角・半角の英数字は別の名前として扱われる", async () => {
    const id = crypto.randomUUID().slice(0, 6);
    expect((await create({ taskTypeName: `ABC${id}` })).status).toBe(201);
    expect((await create({ taskTypeName: `ＡＢＣ${id}` })).status).toBe(201);
  });
  it("別のプロダクトなら同名で作れる", async () => {
    const name = uniq("shared");
    expect((await create({ taskTypeName: name })).status).toBe(201);
    expect((await create({ taskTypeName: name }, other)).status).toBe(201);
  });
  it("409 のとき、種類は増えない", async () => {
    const name = uniq("dup");
    await create({ taskTypeName: name });
    const before = (await kindNames(p.productId)).length;
    await create({ taskTypeName: name });
    expect((await kindNames(p.productId)).length).toBe(before);
  });
});

describe("同時リクエスト", () => {
  it("同じ名前を同時に 5 回追加すると、201 が 1 つ・残りは 409 で、500 は出ない", async () => {
    const name = uniq("race");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => create({ taskTypeName: name }))
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect((await kindNames(p.productId)).filter((n) => n === name)).toHaveLength(1);
    for (const r of results.filter((r) => r.status === 409)) {
      expect(await r.json()).toEqual({ message: "同じ名前のタスクの種類がすでにあります" });
    }
  });
  it("空白違いの同名を同時に追加しても、201 と 409 になる", async () => {
    const name = uniq("race-trim");
    const results = await Promise.all([
      create({ taskTypeName: name }),
      create({ taskTypeName: ` ${name} ` }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it("別のプロダクトに同じ名前を同時に追加すると、どちらも 201", async () => {
    const name = uniq("race-other");
    const results = await Promise.all([
      create({ taskTypeName: name }),
      create({ taskTypeName: name }, other),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
  });
  it("2 つの種類を同時に同じ名前へ変更すると、200 が 1 つ・409 が 1 つ", async () => {
    const a = await makeKind(p.productId, uniq("ra"));
    const b = await makeKind(p.productId, uniq("rb"));
    const target = uniq("target");
    const results = await Promise.all([
      patch(p.productId, a, p.leader.cookie, { taskTypeName: target }),
      patch(p.productId, b, p.leader.cookie, { taskTypeName: target }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const names = [await kindName(a), await kindName(b)];
    expect(names.filter((n) => n === target)).toHaveLength(1);
  });
  it("追加と、他の種類の同名への変更が同時でも、500 にならず片方だけ成功する", async () => {
    const a = await makeKind(p.productId, uniq("mix"));
    const target = uniq("mix-target");
    const results = await Promise.all([
      create({ taskTypeName: target }),
      patch(p.productId, a, p.leader.cookie, { taskTypeName: target }),
    ]);
    const s = results.map((r) => r.status);
    expect(s.filter((x) => x === 409)).toHaveLength(1);
    expect(s.filter((x) => x === 200 || x === 201)).toHaveLength(1);
  });
});
