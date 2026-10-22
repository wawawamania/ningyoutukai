# Workers 化スパイクの結果(2026-10)

api(Bun + Elysia + better-auth + drizzle)を Cloudflare Workers で動かせるかを、**ローカル(`wrangler dev`)だけ**で確かめた記録。デプロイ、Cloudflare 上のリソース作成、課金が発生する操作はしていない。

## 結論

| 問い | 結論 |
| --- | --- |
| api は Workers で動くか | **動く。** 小さな変更(`worker.ts` の追加、`db` をリクエストごとに作る仕組み)で、既存コードの挙動を変えずに動いた |
| Workers から Containers の Postgres に直接つなげるか | **今の公式の仕組みでは、そのままはつなげない。** Workers から Containers へは、Durable Object 経由(`getContainer` / `ctx.container`)が入口で、`pg` のようなドライバが使う「Workers から出る生の TCP」では届かない。DO の中で `getTcpPort(5432).connect()` を使う方法はあるが、Postgres での動作確認の例は公式に無く、自作のプロキシが要る(未検証) |
| 推奨する構成 | **Postgres はマネージド(Neon など)に置き、Workers から Hyperdrive 経由でつなぐ。** Containers の Postgres は、ディスクが永続化されないこともあり、本番の主 DB には向かない(詳細は後述) |

## 1. Elysia を Workers で動かす

成果物: `api/src/worker.ts`、`api/wrangler.jsonc`。`app.ts` は変えていない。

試したこと:

1. `export default { fetch: app.fetch }` だけ → `GET /` が 500。`EvalError: Code generation from strings disallowed`。Workers はリクエスト処理中の `new Function` / `eval` を禁止するが、Elysia は AOT コンパイルでこれを使う。
2. `new Elysia({ aot: false }).use(app)` → `/`、`/swagger`、GET 系は動く。**ただし、`app.ts` の `/api/auth/*` に付けている `parse: "none"` が効かず**、Elysia が先にボディを読んでしまい、better-auth の POST(`/api/auth/sign-in/social` など)が `Body has already been used` で 500 になる。`aot: false` は使えない。
3. **採用: `new Elysia({ adapter: CloudflareAdapter }).use(app).compile()`**(`elysia/adapter/cloudflare-worker`。Elysia 本体に同梱で、別パッケージは不要)。このアダプタは、モジュールの読み込み時(グローバルスコープ。ここでは code generation が許される)にルートを事前コンパイルする。`parse: "none"` も効き、POST も動く。

`process.env`: `nodejs_compat` と `compatibility_date >= 2025-04-01` で、`wrangler.jsonc` の `vars` や `.dev.vars` が `process.env` に入る。`auth.ts` の `process.env.BETTER_AUTH_URL` などはそのまま動いた(認可 URL の `redirect_uri` に `.dev.vars` の値が出た)。`dotenv/config` の import も問題なし。

Bun 固有の API は、api の本体では使っていない(`bun:test` はテストのみ)ので、import の解決で詰まる点は無かった。`pg` は `nodejs_compat` の `net` / `tls`(内部で `cloudflare:sockets`)で動く。

## 2. drizzle + Postgres ドライバ

現在のドライバ(`drizzle-orm/node-postgres` + `pg`)のまま動いた。ただし**接続の扱いに落とし穴がある。**

- モジュールのトップレベルで作った `db`(接続プール)のまま動かすと、1 回目のリクエストは動くが、**2 回目以降に固まる**(`Worker's code had hung`)。Workers は、あるリクエストで開いた TCP ソケットを別のリクエストで使えないため。`GET /api/auth/get-session` のあとの `GET /api/product` で再現した。
- 解決: `src/db/index.ts` で `db` を `Proxy` にして、`AsyncLocalStorage`(`nodejs_compat` で使える)に入っている「そのリクエスト用の `db`」を使う。入っていなければ従来どおりのプールを使う(Bun のローカル起動とテストは挙動が変わらない)。`worker.ts` が、リクエストごとに `createDb()` で作り、`dbStorage.run()` で差し込み、終わったら `ctx.waitUntil(db.$client.end())` で閉じる。
- 確認: 同時 20 リクエストの `GET /api/product` が全部 200。書き込み(プロダクト作成、タスク作成。トランザクションを含む)も成功。
- **Hyperdrive**: `wrangler.jsonc` に `hyperdrive` バインディング(`localConnectionString` 付き)を足した別設定で、`env.HYPERDRIVE.connectionString` を `createDb` に渡す形も、ローカルで動いた(`worker.ts` は、`HYPERDRIVE` があればそれを、なければ `DATABASE_URL` を使う)。本番では Hyperdrive が接続の再利用(プール)を引き受けるので、リクエストごとに接続を作るコストが下がる。
- `postgres`(postgres.js)は試していない。`pg` で動いているので、乗り換える理由が無い。

確認したリクエスト(使い捨ての Postgres、ダミーのユーザーとセッションを直接 INSERT):

| リクエスト | 結果 |
| --- | --- |
| `GET /` | 200 |
| `GET /swagger` | 200 |
| `GET /api/auth/get-session`(cookie なし) | 200 `null` |
| `GET /api/auth/get-session`(署名つき cookie) | 200、DB のセッションとユーザーが返る |
| `GET /api/product`(cookie なし) | 401 |
| `GET /api/product`(cookie あり) | 200 |
| `POST /api/product`、`POST .../task` | 201 |
| `OPTIONS /api/product`(CORS preflight) | 204、`Access-Control-Allow-Origin` が `WEB_ORIGIN` |

## 3. better-auth

- DB アダプタ(drizzleAdapter)は、上の `db` の Proxy でそのまま動く。
- `POST /api/auth/sign-in/social`(github)が、`https://github.com/login/oauth/authorize?...` の URL と `better-auth.state` cookie を返す。外部には接続していない。
- `BETTER_AUTH_URL` は Workers の変数(`vars` / シークレット)として渡す。`trustedOrigins` は `WEB_ORIGIN`。
- Workers では `Date`、乱数、`crypto.subtle` などが使われるが、問題は出なかった。

## 4. メール

`mailer.ts` は `fetch` と `process.env` だけを使うので、そのまま動く。`RESEND_API_KEY` 未設定で、タスク作成時に `[mailer] RESEND_API_KEY が未設定のため送信しません` のログだけ出ることを確認した(送信していない)。

## 5. Cloudflare Containers で Postgres

公式ドキュメントで確認した事実(2026-10 時点):

- **料金**: Workers Paid($5/月)が必要。Free プランには Containers の枠が無い。従量は、メモリ $0.0000025/GiB 秒、CPU $0.000020/vCPU 秒(実際に使った分だけ)、ディスク $0.00000007/GB 秒。含まれる枠は、25 GiB 時間、375 vCPU 分、200 GB 時間。
- **インスタンス**: lite(256 MiB、ディスク 2 GB)から standard-4(12 GiB、ディスク 20 GB)まで。Postgres なら basic(1 GiB、ディスク 4 GB)以上が目安。
- **ディスクは一時的(ephemeral)**: 「All disk is ephemeral by default」。コンテナが眠る/入れ替わると、イメージから新しいディスクで起動する。永続化の方法は、スナップショット(`durable_object` のスケジューリングでのみ。不変)か、FUSE で R2 などに置く(SSD の性能は出ない)だけで、Postgres のデータディレクトリには不安がある。
- **接続の入口**: リクエストは Worker → Durable Object → コンテナ(`ctx.container` / `getContainer(env.X, id)`)。エンドユーザーからコンテナへ、非 HTTP の TCP/UDP を直接送ることはできない。
- **生の TCP**: Durable Object の中では `this.ctx.container.getTcpPort(port).connect(addr)` で、生のソケットが使える(公式ブログでは gRPC などを通す例。「any TCP-based protocol」と書かれているが、データベースの例は無い)。ブログの「Workers/Containers の inbound TCP」は**プライベートベータ**。
- 以上から、**普通の Worker が `pg` で `containers の Postgres` に直接つなぐ方法は、公式には用意されていない。** 通すには、Postgres 用の Durable Object を作り、その中でコンテナの 5432 へのソケットを中継する仕組みを自作する必要がある(未検証。DO はドライバの要求する Socket API とも違う)。さらに、ディスクが永続化されないため、コンテナが再起動するたびに R2 のダンプから復旧する運用になり、直前のダンプ以降のデータを失う。

### 代替案の比較

| 案 | メリット | デメリット | 費用の目安 |
| --- | --- | --- | --- |
| A. Neon + Hyperdrive(**推奨**) | 永続化、バックアップ、PITR が付く。Workers からの接続の実績が多い。Hyperdrive で接続を再利用できる。`pg` / drizzle がそのまま動く(ローカルで確認済み) | Cloudflare の外のサービスが増える。リージョンのレイテンシ(東京リージョンあり) | Hyperdrive は Workers の枠内。Neon は無料枠あり、有料は月 $5〜20 程度(使用量による)。Workers Paid $5(任意) |
| B. Supabase + Hyperdrive | Postgres そのまま。管理画面、バックアップあり | 無料枠は非アクティブで停止する。PITR は有料プラン | 無料〜月 $25(Pro) |
| C. Containers に api と Postgres を同居 | Workers と DB の間の接続問題が消える | api を Workers から外すことになり、「アプリは Workers」の方針と食い違う。ディスクが一時的なのは同じ | Workers Paid $5 + コンテナ(basic を常時で月 $7 前後) |
| D. Containers の Postgres + DO で TCP 中継 | 方針(Containers に Postgres)を保てる | 自作の中継が必要で、未検証。ディスク非永続。ベータ機能に依存。運用負荷が最大 | Workers Paid $5 + コンテナ月 $7 前後 |
| E. PlanetScale Postgres など | 運用が楽 | 価格が高めの傾向。Hyperdrive 経由は可 | 月 $5〜(プランによる) |

(費用は概算。basic = 1 GiB / 4 GB を 30 日常時で、メモリ約 $6.5 + ディスク約 $0.7 から含まれる枠を引いた額。実際の請求額ではない。)

## 6. web

- `npm ci` → `VITE_API_URL=http://api.example.test npm run build` が成功し、`dist/server/wrangler.json` が生成される。`web` で `wrangler dev`(`--remote` なし)を実行すると、`GET /` が 200 で HTML(SSR)を返した。
- `VITE_API_URL` は Vite の `import.meta.env` なので、**ビルド時に JS に埋め込まれる**(クライアントとサーバーの両方のバンドルに `api.example.test` が入っていることを確認)。本番でも、**ビルドの時点で本番の api の URL を渡す**(`VITE_API_URL=https://api.example.com npm run build`)。実行時に変えられないので、環境ごと(staging / production)にビルドし直す。
- cookie(web と api が別オリジンのとき):
  - 今のコードは、web の `fetch` と `authClient` が `credentials: 'include'`、api の CORS が `origin: WEB_ORIGIN` + `credentials: true` で、必要な側は揃っている。
  - **`*.workers.dev` どうしは、別サイト扱い**(`workers.dev` は Public Suffix List に載っている)なので、`web.xxx.workers.dev` と `api.xxx.workers.dev` では cookie を共有できず、better-auth の cookie(`SameSite=Lax`)は、web からの fetch に付かない。
  - **推奨: 同じ親ドメインのカスタムドメインにする**(例: `app.example.com` と `api.example.com`)。この場合は同一サイトなので `SameSite=Lax` のままでも、fetch に cookie が付く。better-auth は、`advanced.crossSubDomainCookies: { enabled: true, domain: ".example.com" }` で、cookie を親ドメインに付ける(web の SSR 側で cookie を読みたいときに必要)。`trustedOrigins` と `WEB_ORIGIN` には web のオリジンを入れる。
  - 別サイトのまま使うなら、`advanced.defaultCookieAttributes: { sameSite: "none", secure: true }` が要る(ブラウザの third-party cookie の制限で不安定なので、非推奨)。
  - あるいは、web の Worker で `/api/*` を api に転送(Service Binding)して、同一オリジンにする手もある。

## 詰まった点

1. Elysia の AOT が Workers で `EvalError` → Cloudflare アダプタ + `.compile()`。
2. `aot: false` では `parse: "none"` が無視されて、better-auth の POST が壊れる → 採用しない。
3. トップレベルの `pg` プールを使い回すと 2 回目から固まる → リクエストごとの `db`。
4. `ExecutionContext` の型が api の tsconfig(`bun-types` のみ)に無い → `worker.ts` に最小の型を書いた。
5. 使い捨ての Postgres で `bun test` を回すときは、`DATABASE_URL` を渡す(この worktree には `api/.env` が無い)。

## 試したコマンド

```bash
# 使い捨ての Postgres(別ポート)にマイグレーションを適用
docker run -d --name spike-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=spike -p 5441:5432 postgres:17
cat api/drizzle/*/migration.sql | docker exec -i spike-pg psql -U postgres -d spike

# api(ローカルの Workers)
cp api/.dev.vars.example api/.dev.vars   # DATABASE_URL を使い捨ての DB に向ける
cd api && npx wrangler dev --port 8787   # = bun run dev:worker

# web
cd web && VITE_API_URL=... npm run build && npx wrangler dev --port 8790
```

認証つきの確認は、`user` と `session` を直接 INSERT し、`better-auth.session_token=<token>.<HMAC-SHA256(token, BETTER_AUTH_SECRET) の base64>`(URL エンコード)の cookie を作って送った。

## 推奨構成と、本番に必要な作業

推奨: **web / api = Workers、Postgres = Neon(東京)+ Hyperdrive、バックアップ = R2(`pg_dump` を定期実行)。** `infra/` にあるダンプとリストアの仕組みは、接続先が Neon になるだけでそのまま使える。

1. Postgres の置き場所を決める(Neon / Supabase / 他)。決まったら `docs/infra.md` の構成図と方針を更新する。
2. Hyperdrive の設定を作る(`wrangler hyperdrive create`。本番の接続文字列で)。`api/wrangler.jsonc` に `hyperdrive` バインディング(`HYPERDRIVE`)を足す。
3. `api/wrangler.jsonc` の `vars` / シークレット(`wrangler secret put`)に `DATABASE_URL`(Hyperdrive を使わない場合)、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`WEB_ORIGIN`、`GITHUB_CLIENT_ID/SECRET`、`GOOGLE_CLIENT_ID/SECRET`、`RESEND_API_KEY`、`MAIL_FROM` を設定する。
4. カスタムドメイン(同じ親ドメイン)を用意する。`app.` と `api.` を Workers のルートに割り当て、better-auth の `crossSubDomainCookies` を設定する(`auth.ts` の変更が要る)。GitHub / Google の OAuth のコールバック URL を `https://api.<ドメイン>/api/auth/callback/<provider>` に登録する。
5. web のビルドに本番の `VITE_API_URL` を渡す。`web/wrangler.jsonc` の name を整える。
6. マイグレーション(`drizzle-kit migrate`)を、Postgres の用意後、デプロイ前に実行する手順を決める(CI など)。
7. `pg_dump` → R2 のバックアップを、Cron Trigger で動かす(`infra/README.md`)。リストアの手順を、新しい DB で再確認する。
8. api の `bun run build` 相当(`wrangler deploy --dry-run` で、バンドルサイズが Workers の上限に収まるかの確認)。Workers Paid か Free かでサイズ上限が違う。
9. CI でのデプロイ(`CLOUDFLARE_API_TOKEN`)と、staging 環境の用意。
10. `worker.ts` の経路(Cloudflare アダプタ + 事前コンパイル、リクエストごとの `db`)に対する自動テストの追加(今のテストは Bun の `app` を直接呼ぶ)。
