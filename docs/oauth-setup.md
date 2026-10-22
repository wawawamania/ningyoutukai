# GitHub / Google ログインの設定手順

ログイン画面から、GitHub と Google でログインできるようにするための設定。`api` に、OAuth アプリの**クライアント ID とシークレット**を渡す必要がある。未設定の間は、ログインのボタンを押しても、api が「プロバイダが見つかりません」を返す(`api/src/auth.ts` は、環境変数が揃っているプロバイダだけを有効にする)。

## 全体の流れ

1. GitHub と Google の画面で、OAuth アプリ(クライアント)を作る(**コールバック URL** を登録する)
2. 発行された**クライアント ID とシークレット**を、`api/.env` に書く
3. api を再起動して、`http://localhost:3000/` からログインを試す

シークレットは、**コミットしない**(`api/.env` は gitignore 済み)。チームで共有するときは、チャットなど、リポジトリの外で渡す。

## コールバック URL

better-auth が、認可の URL に入れるコールバックは、`<BETTER_AUTH_URL>/api/auth/callback/<プロバイダ>`(テストで確認済み: `api/tests/auth/social-sign-in.test.ts`)。ローカルの開発では、`BETTER_AUTH_URL` は `http://localhost:3001`。

| プロバイダ | コールバック URL(ローカル) |
| --- | --- |
| GitHub | `http://localhost:3001/api/auth/callback/github` |
| Google | `http://localhost:3001/api/auth/callback/google` |

コールバックは、**web(ポート 3000)ではなく、api(ポート 3001)**。本番では、`BETTER_AUTH_URL` を本番の api の URL にして、同じ形のコールバック URL を、別の OAuth アプリ(または、同じアプリに追加)として登録する。

## GitHub

1. GitHub の「Settings → Developer settings → OAuth Apps → New OAuth App」で作る(公式: <https://docs.github.com/ja/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app>)
2. 入力する項目
   - Application name: 任意(例: `人形使い (local)`)
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: 上の表の GitHub のコールバック URL
3. 作成後に表示される **Client ID** と、「Generate a new client secret」で作る **Client secret** を控える

`api` は、GitHub に `read:user` と `user:email` のスコープを求める(`api/src/auth.ts`)。`user:email` は、GitHub でメールアドレスを非公開にしている人でも、メールアドレスを取得するため。

## Google

1. Google Cloud Console で、プロジェクトを選び(なければ作る)、「API とサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID」で作る(公式: <https://developers.google.com/identity/protocols/oauth2>)
2. 初めての場合は、「OAuth 同意画面」の設定を求められる。アプリ名、サポートメール、デベロッパーの連絡先を入れる。公開状態が「テスト」のときは、**テストユーザーとして登録したアカウントだけ**がログインできる(チームの Google アカウントを、テストユーザーに追加する)
3. OAuth クライアント ID の入力項目
   - アプリケーションの種類: ウェブ アプリケーション
   - 承認済みのリダイレクト URI: 上の表の Google のコールバック URL
4. 作成後に表示される **クライアント ID** と **クライアント シークレット** を控える
5. Google Cloud Console の「API とサービス → ライブラリ」で **Google Calendar API** を有効にする

ログイン時は、これまでどおり基本プロフィールのスコープだけを要求する。カレンダーを使う人は、ログイン後にホーム画面の「Googleカレンダーを連携」を押す。この操作で `https://www.googleapis.com/auth/calendar.events` を追加で許可すると、その人が担当する期限付きタスクが本人のメインカレンダーに、開始・終了を期限時刻にそろえた予定として登録される。時刻は日本時間で保存する。Google側の同意画面にCalendar APIの権限が表示される。

Googleのテスト公開中は、カレンダー連携を試すアカウントもOAuth同意画面のテストユーザーに追加する。既にログイン済みでも、カレンダー連携の操作で追加権限への同意が必要。

## `api/.env` に書く

`api/.env.example` に、項目の一覧がある。次の 4 つを埋める。

```
GITHUB_CLIENT_ID=<GitHub の Client ID>
GITHUB_CLIENT_SECRET=<GitHub の Client secret>
GOOGLE_CLIENT_ID=<Google のクライアント ID>
GOOGLE_CLIENT_SECRET=<Google のクライアント シークレット>
```

GitHub か Google のどちらか片方だけでも動く(揃っているプロバイダだけが有効になる)。あわせて、次が設定されていること。

```
BETTER_AUTH_URL=http://localhost:3001
BETTER_AUTH_SECRET=<openssl rand -hex 32 などで作った、ランダムな文字列>
WEB_ORIGIN=http://localhost:3000
```

## 動作の確認

1. DB、api、web を起動する(手順は [dev-notes.md](./dev-notes.md) の「動かして確認する方法」)
2. `http://localhost:3000/` を開き、「GitHubではじめる」(キーボードの `1`)、または「Googleではじめる」(`2`)を押す
3. GitHub / Google の認可画面で許可すると、`http://localhost:3000/` に戻り、名前とメールアドレスが表示される(ログイン済みの画面)
4. 「ログアウト」を押すと、ログイン画面に戻る

うまくいかないとき:

| 症状 | 原因と対処 |
| --- | --- |
| 画面に `ERR Provider not found` と出る | 該当プロバイダの `*_CLIENT_ID` と `*_CLIENT_SECRET` が、`api/.env` にない。設定して、api を再起動する |
| 認可画面で「redirect_uri が一致しない」旨のエラー | OAuth アプリに登録したコールバック URL が、上の表と違う。`BETTER_AUTH_URL` を変えている場合は、その値に合わせる |
| Google で「アクセスをブロック」 | 同意画面が「テスト」の状態で、ログインしたアカウントが、テストユーザーに入っていない |
| `/?error=email_not_found` に戻る | GitHub でメールアドレスを取得できなかった。GitHub 側でメールアドレスを設定する(非公開でもよい) |
| `/?error=access_denied` に戻る | 認可画面で、許可せずに戻った |
| カレンダー連携後も予定が追加されない | Google Calendar API が有効か、同意画面でカレンダー権限を許可したかを確認する。タスク作成自体は成功し、連携失敗はAPIログに記録される |

## ログイン後に保存されるもの

- **better-auth の `user`**: 名前、メールアドレス、画像。GitHub でログインした人は、**GitHub のユーザー名(login)**が `github_id` に入る。ログインのたびに更新されるので、ユーザー名を変えても追従する(`api/src/auth.ts` の `mapGithubProfile`)。
- **アプリ側の `users`**: メールアドレスで `user` に対応づけて、`github_id` に、同じユーザー名を写す(`api/src/lib/app-user.ts`)。別の人がすでに同じユーザー名を持っている場合は、エラーにせず、写さない(警告をログに出す)。
- **`account`**: プロバイダごとの連携情報。

要件の「GitHub の username でメンバーを招待する」は、この `github_id`(ユーザー名)で探す前提。

## まだ決まっていないこと(要件の未決事項)

- 同じ人が、GitHub と Google の**両方**でログインしたときの扱い(メールアドレスが同じなら、同じユーザーとして扱うか)。`api/src/auth.ts` に、アカウントの連携(`account.accountLinking`)の設定はなく、better-auth の既定の動作になる。better-auth のコードでは、メールアドレスが同じで、プロバイダが信頼できる(またはメールが確認済みの)場合は、既存のユーザーにつなぐ実装がある(`better-auth/dist/oauth2/link-account.mjs`)。実際にどうなるかは、両方でログインして確認する必要がある(未確認)
- GitHub のユーザー名を変えたあと、前のユーザー名を別の人が使い始めた場合の扱い
- Google の `sub`(アプリ側の `users.google_sub`)は、まだ保存していない
