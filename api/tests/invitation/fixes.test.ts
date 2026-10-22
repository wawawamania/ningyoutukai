import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../src/db";
import { productInvitations, users } from "../../src/db/schema";
import { mailer } from "../../src/lib/mailer";
import { productRoutes } from "../../src/routes/product";
import { invitationRoutes } from "../../src/routes/invitation";
import { cleanup, createOutsider, setupProduct } from "../task/helpers";

const app = new Elysia().use(invitationRoutes).use(productRoutes);

function request(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  );
}

type Ctx = Awaited<ReturnType<typeof setupProduct>>;
let p: Ctx;
const sendSpy = spyOn(mailer, "send");
const errorSpy = spyOn(console, "error");

beforeAll(async () => {
  p = await setupProduct({ members: 0 });
  sendSpy.mockResolvedValue({ ok: true });
});
afterEach(() => {
  sendSpy.mockReset().mockResolvedValue({ ok: true });
  errorSpy.mockClear();
});
afterAll(async () => {
  sendSpy.mockRestore();
  errorSpy.mockRestore();
  await cleanup();
});

const invite = (body: unknown) =>
  request("POST", `/api/product/${p.productId}/invitation`, { cookie: p.leader.cookie, body });
const list = (cookie: string) => request("GET", "/api/invitation", { cookie });
const uniq = () => crypto.randomUUID().slice(0, 8);
const pendingOf = async (productId: string) =>
  (await db.select().from(productInvitations).where(eq(productInvitations.productId, productId))).filter(
    (i) => i.status === "pending"
  );

async function createInvitee(githubId?: string) {
  const o = await createOutsider();
  expect((await list(o.cookie)).status).toBe(200); // users の行を作る
  if (githubId) await db.update(users).set({ githubId }).where(eq(users.email, o.email));
  return o;
}

describe("招待の不具合修正", () => {
  it("同じ相手への同時の招待は、201 が 1 件で残りは 409、DB の行も 1 行", async () => {
    const email = `race-${uniq()}@example.com`;
    const results = await Promise.all(Array.from({ length: 20 }, () => invite({ email })));
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(19);
    const rows = (await pendingOf(p.productId)).filter((i) => i.inviteeIdentifier === email);
    expect(rows.length).toBe(1);
  });

  it("登録済みの相手への同時の招待も、1 件だけ", async () => {
    const gh = `race-${uniq()}`;
    const u = await createInvitee(gh);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => invite(i % 2 ? { githubId: gh } : { email: u.email }))
    );
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(((await (await list(u.cookie)).json()) as unknown[]).length).toBe(1);
  });

  it("NUL 文字を含む githubId / email は 422 で、500 にならない", async () => {
    expect((await invite({ githubId: `nul\u0000-${uniq()}` })).status).toBe(422);
    expect((await invite({ email: `nul\u0000-${uniq()}@example.com` })).status).toBe(422);
  });

  it("mailer.send が例外を投げても 201 で、記録される", async () => {
    sendSpy.mockRejectedValue(new Error("boom"));
    const email = `throw-${uniq()}@example.com`;
    const res = await invite({ email });
    expect(res.status).toBe(201);
    expect(errorSpy).toHaveBeenCalled();
    expect((await pendingOf(p.productId)).some((i) => i.inviteeIdentifier === email)).toBe(true);
  });

  it("先頭に @ を付けた githubId でも、登録済みの人の一覧に届き、@ なしで保存される", async () => {
    const gh = `at-${uniq()}`;
    const u = await createInvitee(gh);
    const res = await invite({ githubId: `@${gh}` });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ inviteeIdentifier: gh });
    expect(((await (await list(u.cookie)).json()) as unknown[]).length).toBe(1);
  });

  it("@ が 2 つ以上続く githubId や @ だけの githubId は 400", async () => {
    expect((await invite({ githubId: `@@${uniq()}` })).status).toBe(400);
    expect((await invite({ githubId: "@" })).status).toBe(400);
  });

  it("未登録のメールで招待した人を、登録後に GitHub username で招待しても、重複せず 409", async () => {
    const gh = `after-${uniq()}`;
    const o = await createOutsider();
    expect((await invite({ email: o.email })).status).toBe(201); // 未登録: user_id = null
    expect((await list(o.cookie)).status).toBe(200); // ログイン = users の行ができる
    await db.update(users).set({ githubId: gh }).where(eq(users.email, o.email));
    expect((await invite({ githubId: gh })).status).toBe(409);
    const rows = (await pendingOf(p.productId)).filter((i) => i.inviteeIdentifier === o.email);
    expect(rows.length).toBe(1);
  });
});
