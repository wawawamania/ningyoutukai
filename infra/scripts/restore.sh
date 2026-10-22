#!/bin/bash
# ダンプから、指定したデータベースに復元する。
#
# 使い方:
#   RESTORE_SERVER_URL=postgres://user:pass@host:5432/postgres \
#     ./restore.sh <ダンプのファイル or R2 のキー> <復元先のDB名> [--force]
#
# - 復元先の DB 名は必須。DB が無ければ作成する。
# - 復元先に既存のテーブルがあるときは --force が無いと止まる。
# - 第 1 引数がファイルとして存在しなければ R2 のキーとして取得する(R2_* が必要)。
# - COMPARE_URL を指定すると、復元後にそのデータベースと行数を比較する(verify.sh)。
set -euo pipefail
here="$(dirname "$0")"
source "$here/lib.sh"

force=0
args=()
for a in "$@"; do
  if [ "$a" = "--force" ]; then force=1; else args+=("$a"); fi
done
[ ${#args[@]} -eq 2 ] || die "使い方: restore.sh <ダンプのファイル or R2 のキー> <復元先のDB名> [--force]"
src="${args[0]}"
db="${args[1]}"

: "${RESTORE_SERVER_URL:?RESTORE_SERVER_URL(復元先サーバーの接続 URL)を設定してください}"
case "$db" in
  postgres|template0|template1) die "復元先に $db は指定できません" ;;
esac
[[ "$db" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "DB 名は英数字とアンダースコアのみ使えます"

# ダンプの用意(R2 のキーなら取得する)
tmp=""
cleanup() { [ -z "$tmp" ] || rm -rf "$tmp"; }
trap cleanup EXIT
if [ -f "$src" ]; then
  dump="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"
else
  require_r2_env
  tmp="$(mktemp -d)"
  log "R2 から取得します: $src"
  MOUNT_DIR="$tmp" aws_r2 s3 cp "s3://${R2_BUCKET}/${src}" "$(work_path "$tmp/$(basename "$src")")" >&2
  dump="$tmp/$(basename "$src")"
fi
[ -s "$dump" ] || die "ダンプが空、または存在しません"

admin_url="$(conn_url "$(url_with_db "$RESTORE_SERVER_URL" postgres)")"
target_url="$(url_with_db "$RESTORE_SERVER_URL" "$db")"

exists="$(pg psql "$admin_url" -At -c "select 1 from pg_database where datname='$db'")"
if [ -z "$exists" ]; then
  log "データベース $db を作成します"
  pg psql "$admin_url" -v ON_ERROR_STOP=1 -c "create database \"$db\"" >&2
else
  tables="$(pg psql "$(conn_url "$target_url")" -At -c \
    "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')")"
  if [ "$tables" != "0" ] && [ "$force" != "1" ]; then
    die "復元先 $db には既に $tables 個のテーブルがあります。上書きするなら --force を付けてください"
  fi
fi

log "復元します: $(basename "$dump") -> $db"
MOUNT_DIR="$(dirname "$dump")" pg pg_restore --clean --if-exists --no-owner --no-acl \
  --exit-on-error -d "$(conn_url "$target_url")" "$(work_path "$dump")" >&2

if [ -n "${COMPARE_URL:-}" ]; then
  "$here/verify.sh" "$COMPARE_URL" "$target_url" >&2
else
  log "行数の比較はスキップしました(COMPARE_URL 未設定)"
fi
log "復元が完了しました"
