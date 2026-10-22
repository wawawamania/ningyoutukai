#!/bin/bash
# ダンプを R2(S3 互換 API)に保存し、古い世代を整理する。
#
# 使い方:
#   ./upload-r2.sh <ダンプのファイル>     # ningyoutukai/YYYY/MM/<file> に保存
#   ./upload-r2.sh --prune                # 古いダンプの整理だけ行う(既定は対象の表示のみ)
#   PRUNE=1 ./upload-r2.sh --prune        # 実際に削除する
#
# 環境変数:
#   R2_ACCOUNT_ID または R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
#   RETENTION_DAYS (既定 30)  この日数より古いダンプが整理の対象
#   MIN_KEEP       (既定 3)   整理後も最低この数は残す(全削除の事故防止)
#   PRUNE=1                   削除を実行する(既定は表示のみ)
#   R2_PREFIX      (既定 ningyoutukai)
#
# 古さはファイル名の日付(ningyoutukai-YYYYmmdd-HHMMSS.dump)で判定する。
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_r2_env
prefix="${R2_PREFIX:-ningyoutukai}"
retention="${RETENTION_DAYS:-30}"
min_keep="${MIN_KEEP:-3}"
[[ "$retention" =~ ^[0-9]+$ ]] || die "RETENTION_DAYS は数値で指定してください"
[[ "$min_keep" =~ ^[0-9]+$ ]] || die "MIN_KEEP は数値で指定してください"

upload() {
  local file="$1"
  [ -s "$file" ] || die "ダンプが空、または存在しません: $file"
  local name year month key
  name="$(basename "$file")"
  [[ "$name" =~ ^.*-([0-9]{4})([0-9]{2})[0-9]{2}-[0-9]{6}\.dump$ ]] \
    || die "ファイル名が <name>-YYYYmmdd-HHMMSS.dump の形式ではありません: $name"
  year="${BASH_REMATCH[1]}"
  month="${BASH_REMATCH[2]}"
  key="${prefix}/${year}/${month}/${name}"
  log "アップロードします: s3://${R2_BUCKET}/${key}"
  MOUNT_DIR="$(cd "$(dirname "$file")" && pwd)" \
    aws_r2 s3 cp "$(work_path "$file")" "s3://${R2_BUCKET}/${key}" >&2
  # 保存できたか確認する
  aws_r2 s3api head-object --bucket "$R2_BUCKET" --key "$key" >/dev/null \
    || die "アップロード後の確認に失敗しました"
  log "保存しました"
  echo "$key"
}

cutoff_date() {
  if date -v-1d +%Y%m%d >/dev/null 2>&1; then
    date -v-"${retention}"d +%Y%m%d       # BSD (macOS)
  else
    date -d "-${retention} days" +%Y%m%d  # GNU
  fi
}

prune() {
  local cutoff keys all old
  cutoff="$(cutoff_date)"
  keys="$(aws_r2 s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "${prefix}/" \
    --query 'Contents[].Key' --output text | tr '\t' '\n' | grep -E '\.dump$' | sort || true)"
  all="$(echo "$keys" | grep -c . || true)"
  # ファイル名の日付が cutoff より前のものが対象
  old="$(echo "$keys" | while read -r k; do
    [ -n "$k" ] || continue
    d="$(echo "$k" | sed -nE 's#.*-([0-9]{8})-[0-9]{6}\.dump$#\1#p')"
    [ -n "$d" ] && [ "$d" -lt "$cutoff" ] && echo "$k"
  done || true)"
  local n_old
  n_old="$(echo "$old" | grep -c . || true)"
  log "保存中 ${all} 件、保持 ${retention} 日(${cutoff} より前が対象)、整理の対象 ${n_old} 件"
  if [ "$n_old" -eq 0 ]; then return 0; fi
  if [ $((all - n_old)) -lt "$min_keep" ]; then
    die "整理すると残りが MIN_KEEP=${min_keep} 件を下回るため中止しました"
  fi
  local k
  for k in $old; do
    if [ "${PRUNE:-0}" = "1" ]; then
      log "削除: $k"
      aws_r2 s3 rm "s3://${R2_BUCKET}/${k}" >&2
    else
      log "[dry-run] 削除対象: $k"
    fi
  done
  [ "${PRUNE:-0}" = "1" ] || log "削除はしていません。実行するには PRUNE=1 を付けてください"
}

case "${1:-}" in
  --prune) prune ;;
  "") die "使い方: upload-r2.sh <ダンプのファイル> | --prune" ;;
  *) upload "$1" ;;
esac
