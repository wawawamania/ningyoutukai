import { useEffect, useState } from 'react'
import { Github } from 'lucide-react'
import { authClient } from '#/lib/auth-client'

type Provider = 'github' | 'google'

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  )
}

// GitHub は塗りつぶし、Google は枠線(ライト / ダークの色は styles.css のトークン)
// キーボードの 1 / 2 でも押せる(ターミナルの選択肢のように)
const providers: {
  id: Provider
  key: string
  label: string
  icon: React.ReactNode
  className: string
}[] = [
  {
    id: 'github',
    key: '1',
    label: 'GitHubではじめる',
    icon: <Github className="h-5 w-5" aria-hidden="true" />,
    className: 'bg-primary text-on-primary border-2 border-primary',
  },
  {
    id: 'google',
    key: '2',
    label: 'Googleではじめる',
    icon: <GoogleLogo className="h-5 w-5" />,
    className: 'bg-secondary text-outline border-2 border-outline',
  },
]

/**
 * GitHub / Google のログインボタン。
 * ログイン画面はトップページ(`/`)。ログインしたあとも、失敗したときも、`/` に戻る
 * (失敗したときは、`/?error=…` の形で、理由が付く)。
 */
export function LoginButtons() {
  const [pending, setPending] = useState<Provider | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  async function signIn(provider: Provider) {
    setPending(provider)
    setFailed(null)
    try {
      const origin = window.location.origin
      const { error } = await authClient.signIn.social({
        provider,
        // ログインに成功したら、ホームへ。失敗したら、ログイン画面(`/`)に戻って、理由を出す
        callbackURL: `${origin}/home`,
        errorCallbackURL: origin,
      })
      // 成功すると、ブラウザが認可画面に移動する。ここに来るのは、開始に失敗したとき
      if (error) {
        // better-auth のメッセージは英語なので出さない
        setFailed('ログインを開始できませんでした。時間をおいて、もう一度お試しください')
        setPending(null)
      }
    } catch {
      setFailed('サーバーに接続できませんでした。時間をおいて、もう一度お試しください')
      setPending(null)
    }
  }

  // キーボードの 1 / 2 で、ログインを始める(修飾キーつきや、処理中は無視)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const p = providers.find((x) => x.key === e.key)
      if (p && pending === null) void signIn(p.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending])

  return (
    <div className="flex w-full flex-col gap-3">
      {providers.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={pending !== null}
          onClick={() => void signIn(p.id)}
          className={`group flex h-[60px] w-full items-center gap-3 px-4 text-left font-mono text-[16px] transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none ${p.className}`}
        >
          <span className="opacity-60" aria-hidden="true">
            [{p.key}]
          </span>
          {p.icon}
          <span className="flex-1">
            {pending === p.id ? '移動しています…' : p.label}
          </span>
          <span className="opacity-60" aria-hidden="true">
            ⏎
          </span>
        </button>
      ))}
      {failed && (
        <p role="alert" className="border-l-2 border-ink pl-3 font-mono text-sm">
          ERR {failed}
        </p>
      )}
    </div>
  )
}
