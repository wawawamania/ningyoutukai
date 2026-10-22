#!/bin/bash
# データディレクトリが空のとき(初回起動時)だけ docker-entrypoint から呼ばれる。
# RESTORE_FROM_URL が無ければ何もしない(空の DB で起動する)。
# 復元に失敗したら非 0 で終了し、コンテナの起動を失敗させる(空 DB で動き続けないため)。
set -euo pipefail

if [ -z "${RESTORE_FROM_URL:-}" ]; then
  echo "[restore-on-init] RESTORE_FROM_URL が未設定のため、復元せず空の DB で起動します"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "[restore-on-init] ダンプを取得します"
curl --fail --silent --show-error --location --retry 3 \
  --output "$tmp/restore.dump" "$RESTORE_FROM_URL"

if [ ! -s "$tmp/restore.dump" ]; then
  echo "[restore-on-init] ダンプが空です" >&2
  exit 1
fi

echo "[restore-on-init] ${POSTGRES_DB} に復元します"
pg_restore --clean --if-exists --no-owner --no-acl \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$tmp/restore.dump"
echo "[restore-on-init] 復元が完了しました"
