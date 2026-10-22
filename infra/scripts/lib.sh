#!/bin/bash
# infra/scripts 共通の関数。直接実行せず source する。
#
# USE_DOCKER=1 のとき、pg_dump / pg_restore / psql / aws を docker 経由で実行する。
# (手元の pg_dump のバージョンがサーバーより古いときなどに使う)
# その場合 localhost / 127.0.0.1 は host.docker.internal に読み替える。
#
# クライアント(pg_dump / pg_restore / psql)は 18 を使う。pg_dump は自分より新しいサーバーを
# ダンプできないが、古いサーバーはダンプできるため、18 なら本番(Neon 18)も開発(17)も扱える。
# 別の版を使うときは PG_IMAGE=postgres:19 のように環境変数で上書きする。

PG_IMAGE="${PG_IMAGE:-postgres:18}"
AWS_IMAGE="${AWS_IMAGE:-amazon/aws-cli:2.17.0}"

log() { echo "[$(basename "$0")] $*" >&2; }
die() { log "エラー: $*"; exit 1; }

# docker 内から見える URL に読み替える
docker_host_url() {
  echo "$1" | sed -E 's#(@|//)(localhost|127\.0\.0\.1)([:/])#\1host.docker.internal\3#'
}

# 接続 URL の前後の空白・改行・引用符を取り除き、postgres://ユーザー@ホスト/... の形かを検査して返す。
# GitHub の秘密に引用符つきで貼ると、psql が URL と読めず「ユーザー ID が無い」という分かりにくいエラーになるため。
# 値そのものは表示しない(エラーにも出さない)。
clean_db_url() {
  local url="$1"
  url="$(printf '%s' "$url" | tr -d '\r\n' | sed -E "s/^[[:space:]\"']+//; s/[[:space:]\"']+\$//")"
  [[ "$url" =~ ^postgres(ql)?://[^/@]+@[^/]+/[^[:space:]]+$ ]] \
    || die "接続 URL が postgres://ユーザー:パスワード@ホスト/DB名 の形ではありません(前後の引用符・空白・途中の改行を確認してください)"
  echo "$url"
}

# URL を接続先として使える形にする(USE_DOCKER=1 のときだけ読み替える)
conn_url() {
  if [ "${USE_DOCKER:-0}" = "1" ]; then docker_host_url "$1"; else echo "$1"; fi
}

# URL のデータベース名だけを差し替える(クエリ文字列は無い前提)
url_with_db() {
  local url="$1" db="$2"
  echo "${url%/*}/$db"
}

# MOUNT_DIR をコンテナの /work にマウントして実行する
# 使い方: MOUNT_DIR=/path pg pg_dump ...
pg() {
  if [ "${USE_DOCKER:-0}" = "1" ]; then
    docker run --rm -i --user "$(id -u):$(id -g)" \
      --add-host=host.docker.internal:host-gateway \
      -v "${MOUNT_DIR:-$PWD}:/work" -w /work \
      "$PG_IMAGE" "$@"
  else
    "$@"
  fi
}

# pg_dump のメジャー版が、接続先サーバーのメジャー版以上であることを確認する。
# 使い方: check_pg_client_version <接続 URL(conn_url 適用済み)>
check_pg_client_version() {
  local url="$1" client server
  client="$(pg pg_dump --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')"
  server="$(pg psql "$url" -At -c "show server_version_num" | awk '{print int($1/10000)}')"
  [[ "$client" =~ ^[0-9]+$ && "$server" =~ ^[0-9]+$ ]] || die "pg_dump またはサーバーのバージョンを取得できませんでした"
  if [ "$client" -lt "$server" ]; then
    die "pg_dump が $client で、サーバー($server)より古いためダンプできません。USE_DOCKER=1 を付けるか(使う版は PG_IMAGE、既定 postgres:18)、postgres クライアントを 18 以上にしてください"
  fi
}

# ホストのパスをコンテナ内のパスに読み替える(MOUNT_DIR 直下のファイル)
work_path() {
  if [ "${USE_DOCKER:-0}" = "1" ]; then echo "/work/$(basename "$1")"; else echo "$1"; fi
}

# R2(S3 互換)のエンドポイント
r2_endpoint() {
  if [ -n "${R2_ENDPOINT:-}" ]; then
    echo "$R2_ENDPOINT"
  elif [ -n "${R2_ACCOUNT_ID:-}" ]; then
    echo "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  else
    die "R2_ENDPOINT または R2_ACCOUNT_ID を設定してください"
  fi
}

require_r2_env() {
  : "${R2_BUCKET:?R2_BUCKET を設定してください}"
  : "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID を設定してください}"
  : "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY を設定してください}"
  r2_endpoint >/dev/null
}

# aws cli を R2 向けに実行する。MOUNT_DIR をコンテナの /work にマウントする。
aws_r2() {
  local endpoint
  endpoint="$(r2_endpoint)"
  if command -v aws >/dev/null 2>&1 && [ "${USE_DOCKER:-0}" != "1" ]; then
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
      AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
      aws --endpoint-url "$endpoint" "$@"
  else
    docker run --rm -i --user "$(id -u):$(id -g)" \
      --add-host=host.docker.internal:host-gateway \
      -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      -e AWS_DEFAULT_REGION=auto -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
      -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
      -v "${MOUNT_DIR:-$PWD}:/work" -w /work \
      "$AWS_IMAGE" --endpoint-url "$(docker_host_url "$endpoint")" "$@"
  fi
}
