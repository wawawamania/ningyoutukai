# Cloudflare Containers で動かす PostgreSQL。コンテナは Postgres のみ。
# Containers のディスクは永続化されないため、データが空で起動したときだけ
# RESTORE_FROM_URL(R2 のダンプの署名付き URL)から復元する。
FROM postgres:17

# ダンプの取得に curl を使う
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY restore-on-init.sh /docker-entrypoint-initdb.d/10-restore-on-init.sh
RUN chmod +x /docker-entrypoint-initdb.d/10-restore-on-init.sh

# POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB は環境変数で受ける(Workers 側のシークレットで設定)。
# POSTGRES_PASSWORD は必須で、イメージには含めない。
# RESTORE_FROM_URL があるときだけ、初回起動時にダンプから復元する。
ENV POSTGRES_USER=postgres \
    POSTGRES_DB=ningyoutukai

EXPOSE 5432

HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" || exit 1
