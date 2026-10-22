// ターミナル風のウィンドウ(開発者向けの画面。ログイン画面とホームで共通)。角丸は使わない
export function Terminal({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="w-full max-w-[560px] border-2 border-ink bg-surface font-mono shadow-[6px_6px_0_0_var(--color-ink)]">
      <header className="flex items-center gap-3 border-b-2 border-ink px-4 py-2 text-xs">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 border-2 border-ink" />
          <span className="h-2.5 w-2.5 border-2 border-ink" />
          <span className="h-2.5 w-2.5 border-2 border-ink bg-ink" />
        </span>
        <span className="opacity-70">{title}</span>
      </header>
      <div className="space-y-5 p-6 sm:p-8">{children}</div>
    </section>
  )
}

// `$ コマンド` の 1 行
export function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px]">
      <span className="opacity-60" aria-hidden="true">
        ${' '}
      </span>
      {children}
    </p>
  )
}
