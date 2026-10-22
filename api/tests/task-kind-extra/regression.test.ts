import { afterAll, beforeAll, expect, test } from "bun:test";
import { cleanup, kindName, makeKind, patch, post, setupProduct } from "./helpers";

/**
 * 直した不具合の回帰テスト(元は既知の不具合の再現)。
 */

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;

beforeAll(async () => {
  p = await setupProduct();
});
afterAll(cleanup);

const create = (body: unknown) => post(p.productId, p.leader.cookie, body);

// 不具合 1: 対になっていないサロゲート(JSON の "\ud800")を送ると、DB が不正な UTF-8 として拒否し 500 になる。
// 期待: NUL 文字と同じく 422(入力が正しくありません: taskTypeName)。
test("追加: 対になっていないサロゲートは 422 になる(実際は 500)", async () => {
  const res = await create({ taskTypeName: "\ud800" });
  expect(res.status).toBe(422);
});

test("編集: 対になっていないサロゲートは 422 になる(実際は 500)", async () => {
  const id = await makeKind(p.productId, `surrogate-${crypto.randomUUID().slice(0, 6)}`);
  const res = await patch(p.productId, id, p.leader.cookie, { taskTypeName: "\ud800" });
  expect(res.status).toBe(422);
  expect(await kindName(id)).toStartWith("surrogate-");
});

// 不具合 2: 文字列の途中の対になっていないサロゲートは 201 になるが、名前が壊れて保存される("a\udc00b" -> "a�")。
// 期待: 422、または入力どおりに保存される。
test("追加: 途中の対になっていないサロゲートで名前が壊れて保存されない", async () => {
  const input = "a\udc00b";
  const res = await create({ taskTypeName: input });
  if (res.status === 201) {
    expect((await res.json()).taskTypeName).toBe(input);
  } else {
    expect(res.status).toBe(422);
  }
});

// 不具合 3: ゼロ幅の文字だけの名前は、trim() で空にならず 201 で保存され、画面上は見えない名前の種類になる。
// 期待: 空白だけの名前と同じく 400(種類の名前を入力してください)。
for (const [label, ch] of [
  ["ゼロ幅スペース U+200B", "​"],
  ["ゼロ幅接合子 U+200D", "‍"],
  ["ワードジョイナー U+2060", "⁠"],
] as const) {
  test(`追加: ${label}だけの名前は 400 になる(実際は 201)`, async () => {
    const res = await create({ taskTypeName: ch });
    expect(res.status).toBe(400);
  });
}
