#!/bin/bash
# DATABASE_URL のデータベースを pg_dump(カスタム形式)で取得する。
#
# 使い方:
#   DATABASE_URL=postgres://user:pass@host:5432/ningyoutukai ./dump.sh [出力ディレクトリ]
#   USE_DOCKER=1 ./dump.sh   # pg_dump を docker (PG_IMAGE。既定 postgres:18) で実行する
#
# 出力: <出力ディレクトリ>/ningyoutukai-YYYYmmdd-HHMMSS.dump(既定は infra/dumps)
# 標準出力には出力ファイルのパスだけを出す(他のスクリプトから使うため)。
# ダンプにはユーザーのメールアドレス等が入る。リポジトリにコミットしないこと。
set -euo pipefail
source "$(dirname "$0")/lib.sh"

: "${DATABASE_URL:?DATABASE_URL を設定してください}"
DATABASE_URL="$(clean_db_url "$DATABASE_URL")"
out_dir="${1:-$(cd "$(dirname "$0")/.." && pwd)/dumps}"
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"

file="$out_dir/${DUMP_PREFIX:-ningyoutukai}-$(date +%Y%m%d-%H%M%S).dump"
rm -f "$file"

check_pg_client_version "$(conn_url "$DATABASE_URL")"

log "ダンプを取得します"
if ! MOUNT_DIR="$out_dir" pg pg_dump -Fc --no-owner --no-acl \
  -f "$(work_path "$file")" "$(conn_url "$DATABASE_URL")"; then
  rm -f "$file"
  die "pg_dump に失敗しました"
fi

if [ ! -s "$file" ]; then
  rm -f "$file"
  die "ダンプのサイズが 0 です"
fi

log "完了: $(basename "$file") ($(wc -c <"$file" | tr -d ' ') bytes)"
echo "$file"
