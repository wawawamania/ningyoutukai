# ningyoutukai

| ディレクトリ | 内容 | ポート |
| --- | --- | --- |
| `web/` | フロントエンド(TanStack Start。認証は BetterAuth のクライアントから api に接続) | 3000 |
| `api/` | バックエンド(Elysia + drizzle + PostgreSQL。認証は BetterAuth) | 3001 |

## 必要なもの

- [Bun](https://bun.sh/)(api 用)
- Node.js **24 系の最新のパッチ(24.22.1 以上)** / npm(web の開発・ビルドと、`wrangler`・`drizzle-kit` などの CLI 用。本番の実行は Cloudflare Workers で、Node は動かない)。バージョンは `.nvmrc`(24)で示している。セキュリティ修正が出るので、`node --version` で確認する。古い版のときは、Node の公式サイトのインストーラ、`nvm`、`fnm` などで更新する(Homebrew の `node` は 26 系に上がるので、`node@24` を使う)
- Docker(PostgreSQL 用。**docker compose v2**、つまり `docker compose` コマンドが前提です。`docker-compose` では動作を確認していません)

## api の起動(ローカル開発)

```bash
cd api
bun install
docker compose up -d --wait   # dev 用の PostgreSQL 18(localhost:5434)と、メール受信箱 Mailpit(http://localhost:8025)を起動
cp .env.local.example .env.local   # 開発用の環境変数。空欄を下の説明に沿って埋める
bun run db:migrate            # 開発用 DB にマイグレーション適用
bun run dev                   # http://localhost:3001
```

- コンテナは `ningyoutukai-dev-db`(プロジェクト名 `ningyoutukai-dev`、ボリューム `ningyoutukai_dev_pgdata`)。初回起動時に、開発用 DB `ningyoutukai` と、テスト用 DB `ningyoutukai_test` の 2 つができます。
- メール受信箱 Mailpit(コンテナ `ningyoutukai-dev-mailpit`)も同時に起動します。api が送るメール(招待など)は外へは出ず、ここに届きます。**http://localhost:8025** で見られます(メールは永続化しないので、コンテナを止めると消えます)。api は Mailpit の HTTP の送信 API で送るので、SMTP のポート(1025)は使いません。ポート 1025 / 8025 が使用中なら、`api/docker-compose.yml` の `ports` の左側を空いているポートに変え、8025 を変えたら `.env.local` の `MAILPIT_URL` も揃えてください。
- 停止: `docker compose down`(データも消す場合は `docker compose down -v`)
- API のポートを変える場合は環境変数 `PORT` を指定してください。
- Swagger UI: http://localhost:3001/swagger (OpenAPI の定義は `/swagger/json`)。Elysia のルートが自動で載ります。

### DB のポート(5434)が使用中のとき

DB のポートは **5434** です(ホストのローカルの Postgres の 5432 や、旧コンテナの 5433 と衝突しないようにしています)。5434 も使用中なら、`api/docker-compose.yml` の `ports` の左側(`"5434:5432"` の `5434`)を空いているポートに変え、`api/.env.local` の `DATABASE_URL` のポートも同じ値に揃えてください。変えたら `docker compose up -d --wait` をやり直します。

### 旧コンテナ(`api-db-1`、Postgres 17、5433)からの引っ越し

v1 の開発用コンテナ `api-db-1` は、新しいコンテナとは別物です(別のプロジェクト名・ボリューム `api_pgdata`・ポート 5433)。**新しい `docker-compose.yml` は旧コンテナを止めも消しもしません**。両方を同時に動かせます。Postgres 17 のデータは 18 で直接は読めないため、ダンプで移します。

```bash
# 新コンテナを起動してから(上の手順)。移行元(5433)は読み取りしかしません
infra/scripts/dev-db-migrate.sh ningyoutukai_check   # まず確認用の DB に移して、行数の一致を見る
infra/scripts/dev-db-migrate.sh ningyoutukai         # 開発用 DB に移す(既にテーブルがあるときは --force が必要)
```

引っ越しが済んで、新しい DB で問題なく動くのを確かめたら、旧コンテナを片づけます(`docker rm -f api-db-1`、データごと消すなら `docker volume rm api_pgdata`)。消す前に、必要なら `infra/scripts/dump.sh` でダンプを取っておきます。

### api/.env.local の設定

ローカル開発の環境変数は `api/.env.local` に書きます。`api/.env.local.example` をコピーして作ります。`.env.local` と `.env` はコミットしないでください。読み込みの優先順位は **シェルの環境変数 > `.env.local` > `.env`** です(`.env.local` で空にした値は、`.env` に値があっても空のままです)。`.env` は、本番・共通向けに使う場合のもので、ローカル開発では不要です(見本は `api/.env.example`)。

| 変数 | 説明 |
| --- | --- |
| `DATABASE_URL` | 開発用 DB の接続先。`.env.local.example` の既定(`localhost:5434/ningyoutukai`)のままで動きます |
| `TEST_DATABASE_URL` | テストの接続先(省略可)。省略すると、`DATABASE_URL` の DB 名に `_test` を付けたもの。DB 名が `_test` で終わらないと、テストは中止します |
| `BETTER_AUTH_SECRET` | 認証の署名用の秘密。`openssl rand -hex 32` などで生成します。開発では空でも起動しますが、**本番では必須**です |
| `BETTER_AUTH_URL` | api 自身の URL(省略時 `http://localhost:3001`)。OAuth のコールバック URL の元になります |
| `WEB_ORIGIN` | web の URL(省略時 `http://localhost:3000`)。CORS の許可と、ログイン後の戻り先として信頼する URL(better-auth の `trustedOrigins`)に使います |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`、`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | GitHub / Google でログインするための OAuth の情報。ローカル用には、**開発用の OAuth アプリ**を作って、その値を入れます(本番用とは分ける。コールバック URL は `http://localhost:3001/api/auth/callback/<provider>`)。未設定だとログインのボタンが動きません。取得と登録の手順は [docs/oauth-setup.md](./docs/oauth-setup.md) |
| `MAILPIT_URL` | ローカルのメール受信箱 Mailpit の URL。`.env.local.example` の既定は `http://localhost:8025`。設定されていれば、メールは Mailpit(`POST /api/v1/send`)にだけ送られ、外には出ません。**Resend より優先**します。`NODE_ENV=production` では無視します(本番では設定しない)。送信に失敗しても API は失敗せず、ログに出すだけです |
| `RESEND_API_KEY` / `MAIL_FROM` | メール通知(Resend)用。**ローカルでは `RESEND_API_KEY` を空のまま**にします。`MAILPIT_URL` が無く `RESEND_API_KEY` も空(未設定)なら、メールは送らず、宛先・件名・本文をログに出すだけです。`MAIL_FROM` は送信元(例: `人形使い <noreply@example.com>`)で、Mailpit に送るときも使います(省略時は `人形使い <noreply@localhost>`) |

メール通知の注意(本番): Resend の無料の試用(送信元 `onboarding@resend.dev`)では、Resend に登録したアドレス以外には送れません。実際の利用者に送るには、Resend で独自ドメインを認証し、そのドメインのアドレスを `MAIL_FROM` に指定してください。

### スキーマを変更するとき

テーブル定義は `api/src/db/schema/`(入口は `index.ts`、テーブルごとにファイルが分かれています)と、認証用の `api/src/db/auth-schema.ts` にあります(`api/drizzle.config.ts` が両方を読みます)。編集してから、`api` ディレクトリで次を実行します。

```bash
bunx drizzle-kit generate   # api/drizzle/ にマイグレーションを生成(コミットすること)
bunx drizzle-kit migrate    # DB に適用
```

### テスト

`api` ディレクトリで `bun test`(または `bun run test`)。dev 用コンテナを起動してあれば、そのまま実行できます。

- `bun test` は `.env` を先に読むので、`tests/setup.ts` が `.env.local` の値で上書きして、優先順位(シェル > `.env.local` > `.env`)を保ちます。`.env` に旧コンテナ(5433)の設定が残っていても、`.env.local`(5434)が使われます。

- **テストは、開発用の DB ではなく、テスト用の DB(`ningyoutukai_test`)に対して実行されます。** `DATABASE_URL` が開発用の DB を指していても(`.env.local` から読まれても)、`tests/setup.ts` が DB 名に `_test` を付けたものへ切り替えます。`TEST_DATABASE_URL` を指定すれば、それが優先されます。
- **安全装置**: 最終的な接続先の DB 名が `_test` で終わらないときは、テストの開始時に中止します(開発用の DB にテストが走るのを防ぐため)。
- テストの前に、マイグレーション(`api/drizzle/`)が自動で適用されます。
- テスト用 DB が無い、またはコンテナが起動していないときは、`docker compose up -d --wait` を案内するエラーで止まります。

## web の起動

```bash
cd web
npm install
```

認証(better-auth)は **api 側**で動いています(`/api/auth/*`、ユーザー・セッションは DB に保存)。web は `authClient` から api に接続します。

api の URL を変えたいときだけ、`web/.env` に次を書きます(省略時は `http://localhost:3001`。`web/src/lib/api.ts` 参照)。

```
VITE_API_URL=http://localhost:3001
```

```bash
npm run dev     # http://localhost:3000
npm run build   # ビルド確認
```
