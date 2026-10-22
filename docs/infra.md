# インフラ要件メモ

## 構成

| 役割 | 動かす場所 |
| --- | --- |
| アプリ(web / api) | Cloudflare Workers |
| PostgreSQL | Neon(マネージド Postgres)。Workers からは Hyperdrive 経由で接続 |
| DB のバックアップ | Cloudflare R2(`pg_dump` のダンプの保存のみ) |

```
ブラウザ ─▶ web の Worker ──/api/* をサービスバインディングで転送──▶ api の Worker ──Hyperdrive──▶ Neon(Postgres)
                                                                                                   │ pg_dump(GitHub Actions のスケジュール実行)
                                                                                                   ▼
                                                                                              R2(ダンプの保存のみ)
```

本番に上げる手順は [deploy.md](./deploy.md)。

## 方針

1. **アプリは Workers で動かす。** web は TanStack Start、api は Elysia(`api/src/worker.ts`)。コンテナには載せない。
2. **Postgres は Neon。** 永続化・バックアップ・履歴の復元が付く。Workers からは **Hyperdrive** 経由でつなぎ、接続の再利用(プール)は Hyperdrive に任せる。マイグレーションは Hyperdrive を通さず、Neon の **direct** 接続で手元から実行する。
3. **ブラウザから見えるオリジンは web の 1 つだけ(同一オリジン化)。** `*.workers.dev` どうしは別サイトで cookie を共有できないため、web の Worker が `/api/*` をサービスバインディングで api に転送する。cookie は同一サイト、CORS は不要、OAuth のコールバックは `https://<web>/api/auth/callback/...`。カスタムドメインを用意できる場合は、別サブドメイン(`COOKIE_DOMAIN`)にもできる(deploy.md の付録)。
4. **R2 はダンプの保存だけに使う。** アプリのデータやファイルは R2 に置かない。ダンプは Neon の履歴とは別系統のコピー。

## 変更の理由(Containers の Postgres をやめた)

当初は Cloudflare Containers で Postgres を動かす案だった。検証の結果、採用しなかった。

- Containers のディスクは永続化されず、コンテナが止まるとデータが消える(R2 のダンプ頼みになり、直前のバックアップ以降を失う)。
- 単一インスタンスで、可用性・運用の負担が大きい。
- 普通の Worker から `pg` で直接つなげない。Durable Object 経由の中継を自作すると動いたが、公式の `Container` クラスは Postgres に使えず自前実装が必要、リクエストごとに約 +45 ms、コールドスタート約 3 秒。

検証の記録: [infra-spike.md](./infra-spike.md)(api を Workers で動かす見極め)、[infra-do-container.md](./infra-do-container.md)(DO 経由の Containers。コードはブランチ `infra/do-container-spike` に残してある)。

## 現状(2026-10 時点)

- ローカルでは `api/docker-compose.yml` で Postgres 18 を動かしている(v2.0 で 17 から変更。ポート 5434、コンテナ `ningyoutukai-dev-db`。旧コンテナ `api-db-1` は 17・5433 で、別物。本番の Neon は 18。バックアップの道具は 18 のクライアントで、両方をダンプできる。復元はダンプ元と同じメジャー版以上のサーバーへ行う)。web は `bun run dev` 相当(`vite dev`)、api は `bun run dev`。ここは従来どおり。
- Workers 向けのコードと設定は用意済み: `api/src/worker.ts`、`api/wrangler.jsonc`(Hyperdrive・vars)、`web/src/worker.ts`、`web/wrangler.jsonc`(サービスバインディング)。`wrangler deploy --dry-run` でバンドルが作れることを確認済み。
- **本番のリソース(Neon、Hyperdrive、R2、Worker)はまだ作っていない。** 作成とデプロイは [deploy.md](./deploy.md) の手順で行う。
- 同一オリジン化(web 経由で `/api/*` が api に届く)は、ローカルの `wrangler dev`(web と api を同時に起動)で確認済み。デプロイした実環境での確認は未実施。

## 環境変数

api の変数。ローカルは `api/.env`(Bun)か `api/.dev.vars`(`wrangler dev`)、本番は `api/wrangler.jsonc` の `vars` と `wrangler secret put`。

| 変数 | 種別 | 内容 |
| --- | --- | --- |
| `DATABASE_URL` | ローカル / マイグレーション / バックアップ | Postgres の接続 URL。本番の Worker では使わない(Hyperdrive の `HYPERDRIVE` バインディングを使う)。マイグレーションとバックアップでは、手元から Neon の direct を渡す |
| `BETTER_AUTH_SECRET` | シークレット | セッションの署名鍵。本番で必須 |
| `BETTER_AUTH_URL` | vars | better-auth の基準 URL。OAuth のコールバックの基になる。同一オリジン化では web のオリジン |
| `WEB_ORIGIN` | vars | web のオリジン。CORS の許可と `trustedOrigins` |
| `COOKIE_DOMAIN` | vars(任意) | 親ドメイン(例 `.example.com`)。カスタムドメインの別サブドメイン構成(案 D)のときだけ |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | シークレット | GitHub ログイン。揃っているときだけ有効 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | シークレット | Google ログイン。揃っているときだけ有効 |
| `RESEND_API_KEY` | シークレット | メール送信(Resend)。未設定なら送信しない |
| `MAIL_FROM` | vars | メールの送信元アドレス |

web: `VITE_API_URL`(ビルド時に埋め込まれる)。本番は空(同一オリジン。`web/.env.production`)、開発の既定は `http://localhost:3001`。

バックアップ用(`infra/scripts`): `R2_*`、`USE_DOCKER` など。`infra/README.md` を参照。

## 留意点

- Neon の Free / Launch は、無通信で compute が停止する(scale to zero)。再開時、最初のクエリが遅くなる。
- Hyperdrive は既定で SELECT をキャッシュする。この app では `--caching-disabled` で作る(deploy.md)。
- Workers Free は 1 リクエストの CPU 時間が 10 ms まで。超えるなら Workers Paid。
- マイグレーション(`drizzle-kit migrate`)は、Neon の direct 接続(pooled ではない)で、アプリのデプロイ前に実行する。
- ダンプにはユーザーのメールアドレスが入る。リポジトリにコミットしない。

## タスク

- [x] Postgres 用の `Dockerfile` を作成する(`infra/postgres/`)。Containers を採用しなかったため、本番では使わない(ローカルの検証用に残す)
- [x] api を Workers で動かせるようにする(`api/src/worker.ts`。ローカルで確認済み)
- [x] Postgres の置き場所を決める(Neon + Hyperdrive。Containers は不採用)
- [x] web / api を Workers にデプロイする設定を追加する(`wrangler.jsonc`、サービスバインディング、`--dry-run` で確認済み)
- [x] 同一オリジン化(web の Worker が `/api/*` を api に転送)
- [x] マイグレーションを Neon に実行する手順とスクリプト(`bun run db:migrate`)
- [x] デプロイの手順書(deploy.md)
- [x] `pg_dump` を R2 に保存する処理を作る(`infra/scripts/`。ローカルの S3 互換サーバーで動作確認済み。実際の R2 では未確認)
- [x] ダンプからのリストア手順を作成し、動作確認する(`infra/README.md`。使い捨てコンテナへの復元と行数の一致を確認済み)
- [ ] Neon のプロジェクトを作る(リージョン、DB、ロール)
- [ ] Hyperdrive を作り、`api/wrangler.jsonc` の id を置き換える
- [ ] `wrangler.jsonc` の `vars`(`<...>` の部分)を実際の値にする
- [ ] シークレットを `wrangler secret put` で入れる
- [ ] 本番用の GitHub / Google の OAuth アプリを作り、コールバック URL を登録する(Google が `workers.dev` を受け付けるかは未確認)
- [ ] api → web をデプロイし、デプロイ後の確認をする(同一オリジンの実環境での確認を含む)
- [ ] R2 のバケットと、ダンプ用の認証情報を用意する
- [ ] GitHub Actions のスケジュール実行で `backup.sh` を動かす(`.github/workflows/backup.yml`。例は deploy.md)。Neon のダンプで、実際の R2 での保存とリストアを確認する
- [ ] CI からのデプロイ(`CLOUDFLARE_API_TOKEN`)と staging 環境(任意)
- [ ] `worker.ts` の経路(Cloudflare アダプタ、リクエストごとの `db`)の自動テスト
