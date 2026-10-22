# infra

PostgreSQL のダンプ(バックアップ)とリストアの環境。方針は [docs/infra.md](../docs/infra.md) を参照。

- 本番の PostgreSQL は Neon(Hyperdrive 経由)。Cloudflare Containers の Postgres は採用しなかった(`docs/infra-do-container.md`)。
- バックアップは `pg_dump` の出力を Cloudflare R2 にだけ置く。`DATABASE_URL` に Neon の **direct** 接続(`-pooler` なし)を渡して `scripts/backup.sh` を実行する。
- 定期実行は GitHub Actions のスケジュール実行を第一案とする(`docs/deploy.md` の「R2 とバックアップ」)。
- `postgres/`(Dockerfile)は Containers 用に作った、**採用しなかった構成**のもの。本番では使わず、記録とローカルの検証用に残している(Postgres 17 のまま。バックアップの道具の版とは無関係)。
- Postgres の版: 本番(Neon)は 18、開発(`api/docker-compose.yml`)も 18(v2.0 で 17 から変更。旧 v1 のコンテナ `api-db-1` は 17)。バックアップの道具(pg_dump / pg_restore / psql)は **18 のクライアント**(`PG_IMAGE` 既定 `postgres:18`)で、18 も 17 もダンプできる。

## 構成

| パス | 内容 |
| --- | --- |
| `postgres/Dockerfile` | Containers 用の Postgres 17 イメージ(healthcheck 付き。採用しなかった構成) |
| `postgres/restore-on-init.sh` | 初回起動時、`RESTORE_FROM_URL` があればダンプから復元する |
| `scripts/dump.sh` | `pg_dump -Fc --no-owner --no-acl` でダンプを取得する |
| `scripts/upload-r2.sh` | ダンプを R2 に保存する。古い世代の整理(`--prune`) |
| `scripts/restore.sh` | ダンプ(ファイル or R2 のキー)から指定の DB に復元する |
| `scripts/verify.sh` | 2 つの DB のテーブルごとの行数を比較する |
| `scripts/dev-db-migrate.sh` | 旧開発用 DB(`api-db-1`、5433、Postgres 17)を、dev 用コンテナ(5434、Postgres 18)の指定した DB へ引っ越す(移行元は読み取りのみ。ルート README.md の「旧コンテナからの引っ越し」) |
| `scripts/backup.sh` | dump → R2 保存 → 整理の対象表示、を一括実行する |
| `scripts/lib.sh` | 共通関数(docker 経由の実行など) |

ダンプにはユーザーのメールアドレス等が入る。`infra/dumps/` と `*.dump` は `.gitignore` 済み。リポジトリにコミットしないこと。

## 環境変数

値はリポジトリに書かない。シェルの環境変数か、コミットしない `infra/.env` から読み込む。

| 変数 | 用途 | 使うスクリプト |
| --- | --- | --- |
| `DATABASE_URL` | ダンプ元の接続 URL | dump / backup |
| `USE_DOCKER` | `1` で pg_dump / psql / aws を docker で実行 | 全て |
| `PG_IMAGE` | `USE_DOCKER=1` のとき pg_dump / pg_restore / psql に使うイメージ(既定 `postgres:18`) | 全て |
| `R2_ACCOUNT_ID` | R2 のアカウント ID(エンドポイントを組み立てる) | upload / restore / backup |
| `R2_ENDPOINT` | エンドポイントを直接指定(`R2_ACCOUNT_ID` より優先。ローカルの S3 互換サーバー用) | 同上 |
| `R2_BUCKET` | バケット名 | 同上 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 の API トークン | 同上 |
| `R2_PREFIX` | キーの接頭辞(既定 `ningyoutukai`) | upload |
| `RETENTION_DAYS` | 保持日数(既定 30) | upload `--prune` |
| `MIN_KEEP` | 整理後も最低限残す件数(既定 3) | upload `--prune` |
| `PRUNE` | `1` のときだけ古いダンプを削除(既定は表示のみ) | upload `--prune` / backup |
| `RESTORE_SERVER_URL` | 復元先サーバーの接続 URL(DB 名部分は無視される) | restore |
| `COMPARE_URL` | 復元後に行数を比較する相手(ダンプ元)の URL | restore |
| `RESTORE_FROM_URL` | コンテナ初回起動時に取得するダンプの URL(署名付き URL) | postgres/Dockerfile |

`USE_DOCKER=1` のとき、`localhost` は `host.docker.internal` に読み替える。`pg_dump` はサーバーより古い版だと失敗する(17 の pg_dump では 18 のサーバーをダンプできない)。逆に新しい pg_dump は古いサーバーをダンプできるので、クライアントは 18 を使う。手元の `pg_dump` が 18 未満なら `USE_DOCKER=1` を使う。`dump.sh` は、`pg_dump` のメジャー版が接続先サーバーより古いと、ダンプ前に分かりやすいエラーで止まる。

## 使い方

### ダンプを取る

```sh
export DATABASE_URL=postgres://postgres:postgres@localhost:5434/ningyoutukai   # 旧コンテナ api-db-1 なら 5433
USE_DOCKER=1 infra/scripts/dump.sh /tmp/dump-work
# => /tmp/dump-work/ningyoutukai-YYYYmmdd-HHMMSS.dump
```

pg_dump の失敗やサイズ 0 のダンプは異常終了になる。

### R2 に保存する

```sh
export R2_ACCOUNT_ID=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
infra/scripts/upload-r2.sh /tmp/dump-work/ningyoutukai-20261021-133830.dump
# => ningyoutukai/2026/10/ningyoutukai-20261021-133830.dump に保存
```

世代管理は、ファイル名の日付が `RETENTION_DAYS` より古いものが対象。

```sh
infra/scripts/upload-r2.sh --prune          # 対象を表示するだけ(削除しない)
PRUNE=1 infra/scripts/upload-r2.sh --prune  # 実際に削除する
```

整理すると残りが `MIN_KEEP` 件を下回る場合は何も消さずに止まる。

### 一括実行

```sh
infra/scripts/backup.sh   # dump → R2 保存 → 整理の対象表示(PRUNE=1 で削除)
```

### リストア

```sh
export RESTORE_SERVER_URL=postgres://postgres:***@localhost:5440/postgres
export COMPARE_URL=$DATABASE_URL          # 任意。行数をダンプ元と比較する
# ファイルから
infra/scripts/restore.sh /tmp/dump-work/ningyoutukai-20261021-133830.dump restore_test
# R2 のキーから(R2_* が必要)
infra/scripts/restore.sh ningyoutukai/2026/10/ningyoutukai-20261021-133830.dump restore_test
```

- 復元先の DB 名は必須。無ければ作る。`postgres` などの管理用 DB は指定できない。
- 復元先に既存のテーブルがあるときは、`--force` を付けないと止まる(`--clean --if-exists` で上書きされるため)。
- **ダンプを取ったサーバーと同じメジャー版以上のサーバーへ復元する**のが安全。18 のダンプ(Neon)を 17 のサーバーへ復元すると失敗しうる(17 のダンプを 18 へ復元するのは問題ない)。
- 復元後、`COMPARE_URL` があればテーブルごとの行数を比較し、不一致なら異常終了する。

## ローカルでの確認手順

旧開発用 DB(`api-db-1`、5433)や、dev 用コンテナ(`ningyoutukai-dev-db`、5434)は読み取り(ダンプ)だけに使い、復元は別のコンテナに対して行う。

```sh
# 1. 使い捨ての Postgres 18 を別ポートで起動
docker run -d --name pg-restore -e POSTGRES_PASSWORD=test -p 5440:5432 postgres:18
# 2. S3 互換サーバーを起動してバケットを作る(R2 の代わり。例: SeaweedFS)
docker run -d --name s3-local -p 9100:8333 chrislusf/seaweedfs server -s3 -dir=/data
curl -X PUT http://localhost:9100/ningyoutukai-backup
# 3. ダンプ → 保存 → 復元
export USE_DOCKER=1 DATABASE_URL=postgres://postgres:postgres@localhost:5434/ningyoutukai
export R2_ENDPOINT=http://localhost:9100 R2_BUCKET=ningyoutukai-backup R2_ACCESS_KEY_ID=test R2_SECRET_ACCESS_KEY=test
export RESTORE_SERVER_URL=postgres://postgres:test@localhost:5440/postgres COMPARE_URL=$DATABASE_URL
infra/scripts/backup.sh                       # 保存先のキーが出力される
infra/scripts/restore.sh <出力されたキー> restore_test
# 4. 後片付け
docker rm -f pg-restore s3-local
```

MinIO(`quay.io/minio/minio`)でも同じ手順で確認できる。Postgres イメージ単体の確認は次のとおり。

```sh
docker build -t ningyoutukai-postgres infra/postgres
docker run -d --name pg-img -e POSTGRES_PASSWORD=test \
  -e RESTORE_FROM_URL=<ダンプの URL> -p 5441:5432 ningyoutukai-postgres
docker logs pg-img | grep restore-on-init   # 復元のログ
```

## R2 の準備(概要)

1. Cloudflare ダッシュボードの R2 でバケット(例: `ningyoutukai-backup`)を作る。公開設定はしない。
2. R2 の「API トークンを管理」から、そのバケットだけに「オブジェクトの読み取りと書き込み」を許可したトークンを作る。得られる Access Key ID / Secret Access Key を `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` に使う。
3. アカウント ID を `R2_ACCOUNT_ID` に使う。エンドポイントは `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`。
4. 削除(`PRUNE=1`)を使うなら、トークンの権限に削除が含まれることを確認する。誤削除に備え、バケットのライフサイクルルール(例: 90 日で期限切れ)を併用してもよい。
5. 認証情報は Workers のシークレット(`wrangler secret put`)として管理し、リポジトリに書かない。

## 定期実行の方針

GitHub Actions のスケジュール実行で、毎日 1 回(例: 日本時間の深夜)`scripts/backup.sh` を動かす。Cloudflare の Cron Trigger は Worker の中で `pg_dump` を実行できないため、第一案にしない。ワークフローは `.github/workflows/backup.yml`。使い方、登録するシークレット、Neon の履歴との役割分担は `docs/deploy.md` の「R2 とバックアップ」。

## 障害時の復旧手順

1. まず Neon の履歴(ブランチの復元)で戻せるか確認する(プランで決まる期間内の誤操作ならこちらが速い)。
2. R2 の最新のダンプを確認する(`ningyoutukai/YYYY/MM/` 以下。ファイル名の日時が新しいもの)。
3. 新しい Postgres(新しい Neon のプロジェクト / ブランチ)を用意し、`restore.sh <R2 のキー> ningyoutukai` か `pg_restore --no-owner --no-acl` で復元する。ダンプ以降のデータは失われる(RPO はバックアップ間隔)。
4. Hyperdrive の接続先を、新しい DB の direct 接続に更新する(`wrangler hyperdrive update`)。
5. 復元後、`verify.sh` またはアプリの画面で行数・動作を確認する。マイグレーションの状態(`drizzle.__drizzle_migrations`)もダンプに含まれるので、復元後に `bun run db:migrate` を実行しても適用済みのものは再適用されない。

## タスクの状況

docs/infra.md のタスク一覧を参照。
