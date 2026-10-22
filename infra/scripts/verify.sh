#!/bin/bash
# 2 つのデータベースの、テーブルごとの行数を比較する(読み取りのみ)。
#
# 使い方: ./verify.sh <ダンプ元のURL> <復元先のURL>
# 一致すれば 0、不一致なら 1 で終了する。行数だけを表示し、中身は出さない。
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ $# -eq 2 ] || die "使い方: verify.sh <ダンプ元のURL> <復元先のURL>"

counts() {
  local url
  url="$(conn_url "$1")"
  local tables
  tables="$(pg psql "$url" -At -v ON_ERROR_STOP=1 -c \
    "select table_schema||'.'||table_name from information_schema.tables
     where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema')
     order by 1")"
  local t
  for t in $tables; do
    local s="${t%%.*}" n="${t#*.}"
    echo "$t $(pg psql "$url" -At -v ON_ERROR_STOP=1 -c "select count(*) from \"$s\".\"$n\"")"
  done
}

src="$(counts "$1")"
dst="$(counts "$2")"

[ -n "$src" ] || die "ダンプ元にテーブルがありません"

echo "テーブル 行数(ダンプ元 / 復元先)"
paste -d' ' <(echo "$src") <(echo "$dst" | awk '{print $2}') | awk '{printf "%-32s %8s / %-8s\n", $1, $2, $3}'

if [ "$src" = "$dst" ]; then
  log "OK: $(echo "$src" | wc -l | tr -d ' ') テーブルの行数が一致しました"
else
  die "行数が一致しません"
fi
