# api

人形使いのバックエンド(Elysia + drizzle + PostgreSQL。http://localhost:3001)。

セットアップ(`.env.local` の作り方、DB の起動、環境変数の説明)は、ルートの [README.md](../README.md) を見てください。

## 主なコマンド

`api` ディレクトリで実行します。

```bash
bun run dev                 # 開発サーバー(http://localhost:3001)
bun test                    # テスト(テスト用の DB(ningyoutukai_test)に対して実行される)
bunx drizzle-kit generate   # マイグレーションを生成
bunx drizzle-kit migrate    # マイグレーションを DB に適用
```
