> **採用しなかった。** 理由: ディスクが永続化されない、単一インスタンス、`Container` クラスが Postgres で使えず自前実装が必要、リクエストごとの遅延が約 +45 ms、コールドスタートが約 3 秒。本番の Postgres は Neon(Hyperdrive 経由)にした。コードはブランチ `infra/do-container-spike` に残してある(このブランチには取り込んでいない)。以下は検証当時の記録。

# Durable Object 経由で Containers の Postgres につなぐスパイクの結果(2026-10)

`docs/infra-spike.md` で「自作の中継が要る(未検証)」としていた、**Worker → Durable Object(DO)→ Cloudflare Containers の Postgres** の経路を、ローカル(`wrangler dev`、Docker)だけで作って確かめた記録。デプロイ、Cloudflare 上のリソース作成、課金が発生する操作はしていない。

## 結論

| 問い | 結論 |
| --- | --- |
| DO 経由で Containers の Postgres に接続できたか | **できた。** DO の `ctx.container.getTcpPort(5432).connect()` のソケットを、Workers RPC で `ReadableStream` / `WritableStream` として Worker に返し、Worker 側で `pg` の `stream` オプションに渡す方式(候補 (a))で動いた。(b) WebSocket と (c) HTTP ゲートウェイは不要だった |
| トランザクションは動くか | **動く。** 1 リクエストで `pg` の接続を DO 経由で 1 本開き、その中で完結する。プロダクト作成、招待の作成(`db.transaction` + `pg_advisory_xact_lock`)、メンバー削除が成功。宛先 4 種類に対する 20 並列の招待は、宛先ごとに 1 件だけ 201、残りは 409 で、行は 4 件になった(ロックが効いている) |
| 遅延 | 暖まっている状態で、直接接続より **1 リクエストあたり約 +45 ms**(中央値 6 ms → 50 ms)。コールドスタート(コンテナが止まっている / 新規)は **約 2.5〜3 秒**(ローカル) |
| 採用できるか | **技術的には動くが、本番の主 DB としては推奨しない。** ディスクが永続化されず、コンテナが止まるとデータが消える。単一インスタンスで、DO と Containers の運用も増える。**推奨は変わらず、Neon + Hyperdrive。** この経路は、(1) 開発 / ステージング、(2) 将来「全データを `RESTORE_FROM_URL` のダンプから復元できる」運用を許容する場合の選択肢として残す |

## 構成

```
Worker(api, Elysia) ──RPC──▶ DO(PgContainer) ──getTcpPort(5432).connect()──▶ コンテナ(Postgres 17)
   │                          ▲
   │  pg の stream オプション  │ openPg(): { readable, writable } を返す
   └─ DoSocket(Duplex) ◀──────┘
```

- `api/src/pg-container.ts`: DO のクラス `PgContainer`。`openPg()` が、コンテナを(止まっていれば)起動し、Postgres が接続を受けられるまで待ち、5432 への TCP 接続を 1 本開いて `{ readable, writable }` を返す。無通信(`PG_SLEEP_AFTER_SECONDS`、既定 600 秒)でコンテナを止める。
- `api/src/db/do-socket.ts`: `pg` の `stream` 用の `Duplex`(net.Socket もどき)。`connect()` で `openPg()` を呼び、Web ストリームを読み書きする。バックプレッシャー(`push()` が false の間は読まない)と、破棄時の `cancel` / `abort` を実装した。
- `api/src/db/index.ts`: `createDb(url, extra?)`。`extra` があればその設定で `pg.Pool` を作る(なければ従来どおり)。
- `api/src/worker.ts`: 接続先の選び方は次の優先順位。
  1. `env.PG_VIA_DO` があれば DO 経由(`DATABASE_URL` はユーザー / パスワード / DB 名だけに使う。ホスト名は何でもよい)
  2. `env.HYPERDRIVE` があれば Hyperdrive 経由
  3. なければ `DATABASE_URL` に直接
- `api/wrangler.jsonc`: `containers`(`../infra/postgres/Dockerfile`、`instance_type: basic`、`max_instances: 1`)、`durable_objects.bindings`(`PG_VIA_DO`)、`migrations`(`new_sqlite_classes: ["PgContainer"]`)。
- `api/src/cloudflare.d.ts`: 使う分だけの最小の型宣言(`@cloudflare/workers-types` を入れると、テストの `bun-types` と衝突するため)。
- SSL は無効、認証はコンテナ既定の scram-sha-256(パスワードはダミー)。

### `@cloudflare/containers` の `Container` クラスは使えなかった

最初は `Container` クラスを継承したが、**Postgres では起動できなかった。** このクラスは、起動の確認に、ポートへ HTTP リクエストを送る。Postgres は HTTP を話さず、不正な応答を返すので、ローカルの workerd では `Application called abort() to reset Durable Object.` で DO ごと落ちた(`waitForPort` を Postgres 向けに置き換えても、`start()` 内の確認が残るので同じ)。そのため、`ctx.container` を直接使う実装にした(`start` / `monitor` / `signal` と、`alarm()` による無通信の停止は自前)。Postgres の準備確認は、SSLRequest(8 バイト)を送って `N` / `S` が返るのを待つ形にした。5432 は、初期化(復元を含む)が終わるまで開かないので、**復元が終わるまで `openPg()` は待たされる。**

## 検証結果(ローカル、すべて空の DB またはダンプから復元した DB に対して)

環境: macOS、Docker Desktop、wrangler 4.151.3、`instance_type: basic`。

### 1. 基本のリクエスト

| リクエスト | 結果 |
| --- | --- |
| `GET /api/auth/get-session`(cookie なし) | 200 `null`(DB は読まない) |
| `GET /api/auth/get-session`(署名つき cookie) | 200、DB のセッションとユーザーが返る |
| `GET /api/product`(cookie なし) | 401 |
| `GET /api/product`(cookie あり) | 200 |

- `wrangler dev` の初回起動: イメージのビルドと、プロキシ用イメージ(`cloudflare/proxy-everything`)の pull を含めて **約 2〜3 分**。2 回目以降(イメージのキャッシュあり)は、**約 10 秒**で Ready。
- コンテナが起動するのは、最初に DB を使うリクエストのとき(Ready の時点ではまだ起動しない)。

### 2. 書き込み、トランザクション、並列

| 操作 | 結果 |
| --- | --- |
| `POST /api/product`(トランザクション) | 201 |
| `POST .../task` | 201 |
| `POST .../invitation`(`db.transaction` + advisory lock) | 201。同じ相手に再度 → 409 |
| 招待の承諾、メンバー一覧 | 200 |
| `DELETE .../member/:id`(トランザクション) | 204 |
| 同時 20 リクエスト(`GET /api/product`) | すべて 200 |
| 同時 20 リクエスト(`POST task`) | すべて 201 |
| 同時 20 リクエスト(`POST product`、トランザクション) | すべて 201 |
| 同時 20 件の招待(宛先 4 種類) | 201 が 4 件、409 が 16 件。招待の行は 4 件 |

### 3. 遅延

同じ手順を、(A) DO 経由、(B) 同じ worker.ts で `DATABASE_URL` に直接(ローカルの Postgres)で実行した。

| | 直接(B) | DO 経由(A) | 差 |
| --- | --- | --- | --- |
| `GET /api/product` 逐次 30 回の中央値 | 6 ms | 50 ms | +約 44 ms |
| 同上 p90 | 14 ms | 53 ms | |
| 同時 20 の `GET` の全体 | 85 ms | 233〜293 ms | |
| 同時 20 の `POST task` の全体 | 76 ms | 277〜379 ms | |
| 同時 20 の `POST product`(tx)の全体 | 59 ms | 216〜226 ms | |
| 単発の書き込み(tx) | 約 13 ms | 約 52 ms | 約 +40 ms |

- 差は、クエリの数にほぼ依らず、**接続を開くたびにかかる固定費(約 40〜45 ms)**に見える(1 リクエストにつき 1 接続を、DO の RPC 越しに開き、認証のやりとりをするため)。内訳は未計測。認証を `trust` にする(コンテナの内部でしか使わないため)などで減らせる可能性があるが、未検証。
- ローカルの Docker 上の数字で、本番(DO とコンテナが別マシンのことがある)ではさらに増えうる。
- **コールドスタート**: コンテナが止まっている状態(無通信で停止した後、または新規)の最初のリクエストは **約 2.5 秒**(コンテナの作成 + Postgres の初期化 + 接続)。復元(37 KB のダンプ)つきでも約 3.1 秒。暖まった後は上の数字。
- **`sleepAfter` の影響**: `PG_SLEEP_AFTER_SECONDS=20` で、最後に接続を開いてから約 20 秒後に停止(`signal(15)`)し、コンテナが `Exited (0)` になることを確認した。止まるとデータは消える(次の項)。短くすると課金は減るがデータが消える頻度が上がる。既定の 10 分は、常時使う前提では、実質的に常時起動になる。

### 4. 接続の閉じ方、リソースの漏れ

- 約 140 リクエスト(書き込み、トランザクション、並列を含む)の後、コンテナ内の `pg_stat_activity`(自分以外)は **0 件**。
- クライアント切断(リクエストを 5〜35 ms で中断、40 件)の 3 秒後も **0 件**。
- 別プロセスから `pg_terminate_backend` を 15 ms 間隔で撃ちながら 60 リクエスト: すべて 200(撃たれる前に終わった可能性が高く、**接続が切られた場合の挙動の確認としては弱い**)。3 秒後は 0 件で、直後のリクエストも 200。
- `DoSocket` は、破棄時に読み側を `cancel`、書き側を `abort` する。`worker.ts` は、リクエストの終わりに `ctx.waitUntil(db.$client.end())` でプールを閉じる。
- **確認できなかった点**: DO 側の `conn.closed` が、Worker が閉じた後も解決しなかった(接続数の計数が減らなかった)。コンテナ内の Postgres 側では接続は閉じているので、漏れてはいないが、DO 側のソケットの後始末は、ローカルでは観測できなかった。そのため、無通信の判定は接続数ではなく「最後に接続を開いた時刻」だけで見ている。

### 5. コンテナの永続性、復元

- コンテナを止めて作り直す(`wrangler dev` の再起動、または無通信での停止後の再起動)と、**データは消えて空の DB になる**(想定どおり。テーブルも無いので、`get-session` は 500)。
- `RESTORE_FROM_URL`(`infra/postgres/restore-on-init.sh`)に、ローカルの HTTP サーバーで配ったダンプ(`infra/scripts/dump.sh` で開発用 DB を読み取りだけでダンプしたもの)を渡すと、**起動時に復元され、全テーブルの行数がダンプ元と一致した**(`api-db-1` の `products`、`tasks` など 10 テーブル)。復元後の API(認証つき `GET /api/product`、書き込み)も動く。ローカルでは、コンテナから `host.docker.internal` でホストに届いた。
- **復元が終わるまでの待たせ方**: 5432 は復元の後に開くので、`openPg()` が待ち、リクエストは復元の完了後に処理される(ダンプが小さく、体感では差が出なかった。大きなダンプの待ち時間は未計測。`waitForPostgres` の上限は 120 秒)。
- **復元の失敗**: ダンプの URL が 404 のとき、コンテナが終了し、`openPg()` が約 2.7 秒で失敗して API は 500 を返した(固まらない)。ただし、**次のリクエストでコンテナを起動し直す**ので、失敗が続く間はリクエストのたびに起動と失敗を繰り返す。

### 6. 既存への影響

- `bun test --cwd <api>`(使い捨ての Postgres に対して): **833 件すべて成功**。
- `tsc --noEmit`: エラーなし。
- `bun run src/index.ts`(Bun のローカル起動): `GET /` が 200、`GET /api/product` が 401。
- 変更は、`db/index.ts` の `createDb` の第 2 引数(任意)の追加のみ。既存の呼び出しの挙動は変えていない。

## 制約とリスク

| 項目 | 内容 |
| --- | --- |
| データの永続性 | **ディスクは永続化されない。** コンテナが止まる(無通信、デプロイ、障害、メンテナンスでの入れ替え)と、データが消え、最後のバックアップ以降の分を失う。RPO はバックアップの間隔。止まるタイミングは制御しきれない |
| 単一インスタンスの可用性 | `max_instances: 1`、DO も 1 つ(`getByName("pg")`)。コンテナが落ちると、次のリクエストが起動し直すまで(数秒)DB が使えず、起動し直したときは**空の DB**(`RESTORE_FROM_URL` が無ければ)。冗長化、フェイルオーバーは無い |
| DO あたりの負荷 | DO は単一スレッド。`openPg()` の RPC は短いが、データ自体は RPC のストリームが運ぶ。DO あたりのリクエストは 1,000/秒(ソフトリミット)。同時のストリーム数の上限は、公式に明記が見つからなかった(未確認) |
| Worker の外向き接続 | 1 リクエストあたり同時に 6 本まで(Workers の上限)。プールは `max: 4` にしている。1 リクエストで 5 本以上の同時クエリを流す実装は待たされる |
| RPC のストリーム | 公式: バイト指向のストリームのみ。フロー制御(バックプレッシャー)つき。RPC のメッセージの 32 MiB の上限は、ストリームなら超えられる。所有権は受け手に移る。ローカルでは、Postgres のやりとりで問題は出なかったが、大きな結果セット(数十 MB)は未検証 |
| Container クラスの非互換 | 上記のとおり、`@cloudflare/containers` の `Container` は HTTP 前提で使えない。自前の実装(起動、監視、停止、準備確認)を保守する必要がある。ライブラリの更新に追従できない |
| メモリ | `basic` は 1 GiB、1/4 vCPU、ディスク 4 GB。このアプリの規模の Postgres には足りるが、`shared_buffers` などは既定のまま。同時接続や大きな復元で足りなくなるなら `standard-1`(4 GiB、1/2 vCPU) |
| コンテナの停止時間 | 公式: 停止時は SIGTERM、最大 15 分待ってから SIGKILL |
| ローカルとの違い | ローカルは Docker でイメージをビルドし、`host.docker.internal` でホストに届く。デプロイでは `wrangler deploy` がイメージをビルドして Cloudflare のレジストリに push する(Docker が必要、`linux/amd64`)。コンテナの外部通信(復元のダンプの取得)は `enableInternet`(`RESTORE_FROM_URL` があるときだけ true にしている)で、デプロイ後は R2 の署名付き URL に届くかの確認が要る。DO とコンテナの配置(リージョン)、Worker からの距離は、ローカルでは再現できない。**コンテナの起動時間、ポートの準備確認の挙動も、本番では未検証** |
| 起動の確認の窓 | ライブラリ(`Container`)は使っていないが、`wrangler dev` の Docker 上で、コンテナの起動直後に HTTP を送ると DO が落ちることがあった(`Container` を使った実装で確認)。現行の実装は HTTP を送らない |
| ローカルの後始末 | `wrangler dev` を止めると、本体のコンテナは消えるが、プロキシ用コンテナ(`...-proxy`)と、Postgres イメージの匿名ボリュームが残ることがある。手で消す |

### 料金の目安(公式の価格表より)

Workers Paid($5/月)が必要。Containers は使った分だけ: メモリ $0.0000025/GiB 秒、CPU $0.000020/vCPU 秒、ディスク $0.00000007/GB 秒。含まれる枠は、メモリ 25 GiB 時間、CPU 375 vCPU 分、ディスク 200 GB 時間。`basic`(1 GiB、1/4 vCPU、4 GB)を 30 日常時起動すると、メモリ約 2,592,000 GiB 秒 = 約 $6.5(枠 25 GiB 時間 = 90,000 GiB 秒 を引いて約 $6.3)、ディスク約 $0.7(枠を引いて約 $0.3)、CPU は 1/4 vCPU の実使用分(多くは枠内)。合計で **月 $7 前後 + Workers Paid の $5**。DO のリクエスト料金、RPC のデータ量は別途(小さい)。実際の請求額ではない。

## 本番へ進めるなら(この経路を採用する場合の作業)

1. 「データが消えうる」前提を受け入れるかを決める。受け入れるなら、バックアップ(`infra/scripts/backup.sh` を Cron Trigger で。間隔を短く)と、`RESTORE_FROM_URL` に常に最新のダンプの署名付き URL を渡す仕組み(有効期限の更新を含む)が要る。
2. DO に、起動時の復元の URL を渡す方法を決める(`wrangler secret put RESTORE_FROM_URL`。署名付き URL は期限があるので、固定のシークレットでは足りない。DO が R2 から自分で取得する形に変えるのが現実的)。
3. マイグレーション(`drizzle-kit migrate`)を、復元後 / 新規コンテナの起動後に流す手順(DO 経由で流す、または復元するダンプに含める)。
4. `PG_PASSWORD`、`DATABASE_URL` を `wrangler secret put` で設定する。
5. `wrangler deploy --dry-run` でバンドルサイズ、`wrangler deploy` でのイメージの push を確認(Docker 必須)。ここまでは、この調査では実行していない。
6. 接続の固定費(約 40〜45 ms)を減らす検討(認証方式、DO 内の接続の再利用)。
7. 負荷時の挙動(同時接続数、大きな結果セット、長いトランザクション)の確認、DO 側の接続の後始末の確認。
8. コンテナの停止 / 入れ替えの監視と通知。

## Neon + Hyperdrive への切り替え方

`worker.ts` は、`env.PG_VIA_DO` が無く、`env.HYPERDRIVE` があれば Hyperdrive 経由になる。アプリのコード(routes、auth、`db`)は変えない。

1. `api/wrangler.jsonc` から `containers`、`durable_objects`、`migrations` の 3 つを消す(DO のクラスを残す場合は、`delete_classes` のマイグレーションで消す)。`worker.ts` の `export { PgContainer }` と `pg-container.ts` / `do-socket.ts` は、使わなくなったら削除する。
2. Neon でプロジェクトを作り、接続文字列を得る。`wrangler hyperdrive create`(本番の接続文字列で)を実行し、`wrangler.jsonc` に `hyperdrive` のバインディング(`HYPERDRIVE`、ローカルは `localConnectionString`)を足す。
3. `infra/scripts/restore.sh` で、ダンプを Neon に復元し、`verify.sh` で行数を比較する。

## 試したコマンド

```bash
# api(ローカルの Workers + Containers)。Docker が必要
cp api/.dev.vars.example api/.dev.vars   # DO 経由の変数のコメントを外す
cd api && npx wrangler dev --port 8787

# コンテナの Postgres にマイグレーションを入れる(空の DB のとき)
cat api/drizzle/*/migration.sql | docker exec -i <workerd-...-PgContainer-...> psql -U postgres -d ningyoutukai
```

テスト用のユーザーとセッションは、`user` / `session` に直接 INSERT し、`docs/infra-spike.md` の方法で署名つき cookie を作って送った。
