import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LoginButtons } from '#/components/login-buttons'
import { Prompt, Terminal } from '#/components/terminal'
import { authClient } from '#/lib/auth-client'

// ログイン画面(`/`)。ログインに失敗すると、better-auth が `/?error=コード` に戻してくる。
// ログイン済みの人は、ホーム(`/home`)に移す
export const Route = createFileRoute('/')({
  // `error` は、省略できる(`/` へ移すときに、毎回 `search` を渡さなくて済むように、型を `error?` にする)
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === 'string' ? { error: search.error } : {},
  component: Login,
})

const errorMessages: Record<string, string> = {
  access_denied: 'ログインがキャンセルされました。もう一度お試しください',
  email_not_found:
    'メールアドレスを取得できませんでした。GitHub のメールアドレスを公開設定にして、もう一度お試しください',
}

function loginErrorMessage(code: string) {
  return errorMessages[code] ?? 'ログインできませんでした。もう一度お試しください'
}

function Login() {
  const { data: session, isPending } = authClient.useSession()
  const { error } = Route.useSearch()
  const navigate = useNavigate()

  // ログイン済みなら、ホームへ(`replace`: 戻るボタンで、ここに戻って、また移される往復を避ける)
  useEffect(() => {
    if (session?.user) void navigate({ to: '/home', replace: true })
  }, [session?.user, navigate])

  // ログイン状態を確認している間と、ホームへ移している間は、背景だけを出す
  // (ログイン画面が一瞬見えるのを避ける)
  if (isPending || session?.user) return <main className="dot-grid h-screen" />

  return (
    <main className="dot-grid flex h-screen items-center justify-center px-4">
      <Terminal title="~/ningyoutukai — login">
        <h1 className="text-[clamp(2.25rem,7vw,3.5rem)] leading-tight font-bold tracking-tight">
          人形使い
        </h1>
        <div className="space-y-1">
          <Prompt>
            ningyoutukai login
            <span className="cursor ml-1 inline-block h-[1.1em] w-[0.6em] translate-y-[0.2em] bg-ink" aria-hidden="true" />
          </Prompt>
          <p className="text-sm opacity-60"># 誰が、いつ、何をしているか。ひと目で。</p>
        </div>
        <div className="space-y-3">
          <p className="text-sm">? どのアカウントで続けますか?</p>
          <LoginButtons />
          {error && (
            <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
              ERR {loginErrorMessage(error)}
            </p>
          )}
        </div>
        <p className="text-xs opacity-60">キーボードの 1 / 2 でも選べます</p>
      </Terminal>
    </main>
  )
}
