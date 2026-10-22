import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { app } from "./app";
import { createDb, dbStorage } from "./db";

// Cloudflare Workers の入口。`listen` はせず、`fetch` だけを公開する。
// Workers は `new Function` / `eval` を禁止するため、Elysia の AOT コンパイルが使えない。
// app.ts は変えず、ここで Cloudflare 用アダプタの Elysia に `app` を載せて、aot: false で動かす。
const worker = new Elysia({ adapter: CloudflareAdapter }).use(app).compile();

// HYPERDRIVE は任意のバインディング。あれば Hyperdrive 経由、なければ DATABASE_URL で直接つなぐ
type Env = { DATABASE_URL: string; HYPERDRIVE?: { connectionString: string } };

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    // Workers は接続をリクエストをまたいで使い回せないので、リクエストごとに db を作り、終わったら閉じる
    const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
    try {
      return await dbStorage.run(db, () => worker.fetch(request));
    } finally {
      ctx.waitUntil(db.$client.end());
    }
  },
};
