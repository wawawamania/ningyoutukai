#!/bin/bash
# dump -> R2 へ保存 -> (任意で)古い世代の整理 を一連で実行する。
# GitHub Actions のスケジュール実行(または手元)から起動するラッパー。DATABASE_URL は Neon の direct 接続(docs/deploy.md)。
#
# 必要な環境変数: DATABASE_URL, R2_*(upload-r2.sh と同じ)
# 任意: PRUNE=1 を付けると古いダンプを削除する(既定は対象の表示のみ)
#       KEEP_LOCAL=1 を付けるとローカルのダンプを残す(既定は保存後に削除)
set -euo pipefail
here="$(dirname "$0")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
[ "${KEEP_LOCAL:-0}" != "1" ] || trap - EXIT

file="$("$here/dump.sh" "$work")"
key="$("$here/upload-r2.sh" "$file")"
"$here/upload-r2.sh" --prune

echo "$key"
