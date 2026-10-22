#!/bin/bash
# 旧 v1 の開発用 DB(api-db-1、Postgres 17、ポート 5433)のデータを、
# 新しい dev 用コンテナ(ningyoutukai-dev-db、Postgres 18、ポート 5434)へ引っ越す。
#
# 使い方: ./dev-db-migrate.sh <復元先のDB名> [--force]
#   例: ./dev-db-migrate.sh ningyoutukai          # 新コンテナの開発用 DB に引っ越す
#       ./dev-db-migrate.sh migrate_check         # 確認用の DB に引っ越す(無ければ作られる)
#
# - 移行元(旧コンテナ)には**読み取りしかしない**(pg_dump と、行数の比較の select のみ)。
# - 復元先の DB 名は必須。既に同名の DB にテーブルがあれば、--force が無いと止まる(restore.sh の安全装置)。
#   復元先の既存データは、--force を付けたときだけ上書きされる。
# - 復元後、移行元と復元先のテーブルごとの行数を比較する(一致しなければ異常終了)。
# - pg_dump / psql は docker 上の postgres:18 を使う(USE_DOCKER=1。手元に pg_dump が無くても良い)。
#
# 環境変数(既定値は、ローカルの旧コンテナと新コンテナ。ローカル専用の値で、秘密ではない):
#   SRC_DATABASE_URL    移行元。既定 postgres://postgres:postgres@localhost:5433/ningyoutukai
#   DEST_SERVER_URL     復元先のサーバー。既定 postgres://postgres:postgres@localhost:5434/postgres
set -euo pipefail
here="$(dirname "$0")"
source "$here/lib.sh"

[ $# -ge 1 ] || die "使い方: dev-db-migrate.sh <復元先のDB名> [--force]"

SRC_DATABASE_URL="${SRC_DATABASE_URL:-postgres://postgres:postgres@localhost:5433/ningyoutukai}"
DEST_SERVER_URL="${DEST_SERVER_URL:-postgres://postgres:postgres@localhost:5434/postgres}"

# 移行元と復元先が同じサーバー(ホスト:ポート)なら、取り違えを防ぐため止める
hostport() { echo "$1" | sed -E 's#^[a-z]+://([^@]*@)?([^/]+)/.*#\2#'; }
[ "$(hostport "$SRC_DATABASE_URL")" != "$(hostport "$DEST_SERVER_URL")" ] \
  || die "移行元と復元先が同じサーバーです($(hostport "$SRC_DATABASE_URL"))"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export USE_DOCKER=1
log "移行元(読み取りのみ): $(hostport "$SRC_DATABASE_URL")"
dump="$(DATABASE_URL="$SRC_DATABASE_URL" "$here/dump.sh" "$work")"

RESTORE_SERVER_URL="$DEST_SERVER_URL" COMPARE_URL="$SRC_DATABASE_URL" "$here/restore.sh" "$dump" "$@"
