import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '#/components/app-shell'
import { api } from '#/lib/api'
import { authClient } from '#/lib/auth-client'

// ホーム(`/home`)。ログイン必須。未ログインなら、ログイン画面(`/`)へ戻す(`AppShell` が行う)。
// Figma にホーム画面のフレームを読み出せなかったため、プロダクト画面の流儀に沿った素直な作り
export const Route = createFileRoute('/home')({ component: Home })

const roleLabel = { leader: 'リーダー', member: 'メンバー' } as const

const cardBase =
  'flex min-h-24 h-full flex-col justify-between gap-3 border-2 border-ink p-4 hover:bg-side-item focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

function Home() {
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()
  const [calendarLinkError, setCalendarLinkError] = useState(false)
  const calendar = useQuery({
    queryKey: ['google-calendar-status'],
    queryFn: () => api<{ connected: boolean }>('/api/calendar/status'),
    enabled: Boolean(session?.user),
    retry: false,
  })

  async function signOut() {
    await authClient.signOut()
    void navigate({ to: '/', replace: true })
  }

  async function connectGoogleCalendar() {
    setCalendarLinkError(false)
    const { error } = await authClient.linkSocial({
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
      callbackURL: `${window.location.origin}/home`,
      errorCallbackURL: `${window.location.origin}/home`,
      additionalParams: { access_type: 'offline', prompt: 'consent' },
    })
    if (error) setCalendarLinkError(true)
  }

  return (
    <AppShell align="top">
      {({ user, products }) => (
        <div className="w-full max-w-4xl space-y-8">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm opacity-70">ようこそ</p>
              <h1 className="truncate text-[28px] leading-normal font-semibold">
                {user.name}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="h-10 shrink-0 border-2 border-ink px-4 text-sm hover:bg-side-item focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              ログアウト
            </button>
          </header>

          <section
            aria-label="Googleカレンダー連携"
            className="flex flex-col gap-3 border-2 border-ink p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h2 className="text-base font-medium">Googleカレンダー</h2>
              <p className="mt-1 text-sm opacity-70">
                担当者が連携済みなら、その人のメインカレンダーに期限時刻の予定を追加します。
              </p>
              {calendarLinkError && (
                <p role="alert" className="mt-2 text-sm">
                  Googleカレンダーを連携できませんでした。もう一度お試しください。
                </p>
              )}
            </div>
            {calendar.isPending ? (
              <span className="text-sm opacity-60">連携状態を確認中…</span>
            ) : calendar.data?.connected ? (
              <span className="shrink-0 text-sm font-medium">連携済み</span>
            ) : (
              <button
                type="button"
                onClick={() => void connectGoogleCalendar()}
                className="h-10 shrink-0 border-2 border-ink px-4 text-sm hover:bg-side-item focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                Googleカレンダーを連携
              </button>
            )}
          </section>

          <section aria-label="プロダクト" className="space-y-3">
            <h2 className="text-base font-medium">プロダクト</h2>
            {products.isPending ? (
              <p className="text-sm opacity-60">読み込み中…</p>
            ) : products.isError ? (
              <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
                ERR {products.error.message}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-2 xl:grid-cols-3">
                {products.data.map((p) => (
                  <li key={p.productId}>
                    <Link
                      to="/products/$productId"
                      params={{ productId: p.productId }}
                      className={cardBase}
                    >
                      <span className="text-base font-medium break-words">
                        {p.productName}
                      </span>
                      <span className="text-sm opacity-70">
                        {roleLabel[p.role]}
                      </span>
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    to="/products/new"
                    className={`${cardBase} items-center justify-center border-dashed text-base font-medium`}
                  >
                    ＋ プロダクト作成
                  </Link>
                </li>
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
