# v2 で対応すること(申し送り)

v1.0 では、API のエンドポイント(`docs/api.md`)とテーブルの設計を変えない方針にしている。そのために残している暫定対応を、v2 でまとめて直す。

## ユーザーテーブルの統一

- **現状**: ユーザーが 2 つのテーブルに分かれている。
  - `user`(better-auth 用。ID は text。`api/src/db/auth-schema.ts`)
  - `users`(アプリ用。ID は uuid。`product_members.user_id` などが参照。`api/src/db/schema/users.ts`)
- **暫定対応**: ログイン中のユーザーを、メールアドレスで `users` の行に対応づけている(`api/src/lib/app-user.ts`)。`users` に行がなければ、初回のリクエスト時に作る。
- **問題点**:
  - メールアドレスを変更すると、対応づけが切れる(別ユーザー扱いになる)。
  - `users.github_id` と `users.google_sub` は、今は使っておらず null のまま。
- **v2 の方針案**: `users` を廃止し、`product_members.user_id` と `product_invitations.user_id` を `user.id`(text)に向ける。GitHub と Google の ID は better-auth の `account` が持つ。

## タスクの担当者の変更(再割り振り)

- **現状**: 担当者の変更(再割り振り)は v1.0 では提供しない。`PATCH /api/product/{productId}/task/{taskId}` は担当者(`productMemberId`)を受け取らない。
- **v2 で再割り振りを入れる場合に決めること**:
  - 新しい担当者への通知
  - 完了報告済み(`reportedAt`)のタスクの扱い

## 完了済みのタスクの修正方針

- **現状**: 完了済み(`completedAt` あり)のタスクは、`PATCH /api/product/{productId}/task/{taskId}` で変更できない(409)。v1.0 では変更不可とする。
- **v2 で決めること**: 完了後の誤りをどう直すか(完了の取り消し、リーダーによる修正など)。
