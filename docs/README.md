# docs

ningyoutukai のドキュメント置き場です。要件定義、設計(ER 図など)、運用メモをここにまとめます。

## 目次

- [requirements.md](./requirements.md): 人形使い 要件定義
- [api.md](./api.md): API 設計書
- [oauth-setup.md](./oauth-setup.md): GitHub / Google ログインとGoogleカレンダー連携の設定手順(OAuth アプリの登録、`api/.env`)
- [dev-notes.md](./dev-notes.md): 開発中のメモ(暫定にしていること、あとで見直すこと。ログイン画面は暫定のデザイン)
- [v2-todo.md](./v2-todo.md): v2 で対応すること(申し送り)
- [v2.0/development-requirements.md](./v2.0/development-requirements.md): v2.0 Development Requirements(ローカルの開発環境の整備。要件、決めること、作業の分け方)
- [api-tree.md](./api-tree.md): ツリー表示 API の仕様
- [infra.md](./infra.md): インフラ構成(アプリは Workers、PostgreSQL は Neon + Hyperdrive、R2 は DB ダンプの保存のみ)
- [deploy.md](./deploy.md): 本番デプロイの手順書(Neon、Hyperdrive、シークレット、OAuth、バックアップ、ロールバック)
- [infra-spike.md](./infra-spike.md): api を Workers で動かす見極めの記録
- [infra-do-container.md](./infra-do-container.md): Containers の Postgres の検証記録(採用しなかった)

起動手順はルートの [README](../README.md) を参照してください。
