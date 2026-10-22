import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Elysia, t } from "elysia";
import { errorHandler } from "../../src/lib/error-handler";

// レスポンスのスキーマに合わない値を返したときは、サーバー側のバグなので 500 にする

const app = new Elysia()
  .use(errorHandler)
  .get("/bad-response", () => ({ secretField: 1 }) as never, {
    response: { 200: t.Object({ secretField: t.String() }) },
  })
  .get("/ok-response", () => ({ a: "x" }), {
    response: { 200: t.Object({ a: t.String() }) },
  })
  .get("/query", () => "ok", { query: t.Object({ n: t.String() }) });

const call = (path: string) => app.handle(new Request(`http://localhost${path}`));

let errorSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("レスポンスの検証エラー", () => {
  it("スキーマに合わない値を返すと、500 `{ message }` になる(422 にならない)", async () => {
    const res = await call("/bad-response");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "サーバーでエラーが発生しました" });
  });

  it("利用者には、「入力が正しくありません」と出さず、項目名も含めない", async () => {
    const text = await (await call("/bad-response")).text();
    expect(text).not.toContain("入力が正しくありません");
    expect(text).not.toContain("secretField");
  });

  it("原因はサーバーのログに残る", async () => {
    await call("/bad-response");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("スキーマに合う値なら 200", async () => {
    const res = await call("/ok-response");
    expect(res.status).toBe(200);
  });
});

describe("リクエストの検証エラーは、これまでどおり 422", () => {
  it("クエリの検証エラーは 422 で、項目名を含む", async () => {
    const res = await call("/query");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toContain("入力が正しくありません");
    expect(body.message).toContain("n");
  });
});
