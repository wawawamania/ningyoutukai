import { useEffect, useRef, useState } from 'react'

export type ManageMenuItem = { label: string; onSelect: () => void }

const buttonClass =
  'flex h-9 shrink-0 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none'

// 見出しの「管理」メニュー。項目を足すときは items に 1 行足す。項目を押すとメニューを閉じてから onSelect を呼ぶ。
// 項目が 1 つだけ(メンバー向け)のときは、メニューにせず、その項目をボタンとして直接出す
export function ManageMenu({ items }: { items: ManageMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (items.length === 1) {
    return (
      <button type="button" onClick={items[0].onSelect} className={buttonClass}>
        {items[0].label}
      </button>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={buttonClass}
      >
        管理 ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-10 mt-1 flex min-w-40 flex-col border-2 border-outline bg-secondary"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                // 項目は閉じると消えるので、先に「管理」ボタンへフォーカスを移す(ダイアログを閉じたときの戻り先)
                buttonRef.current?.focus()
                setOpen(false)
                item.onSelect()
              }}
              className="h-9 whitespace-nowrap px-3 text-left text-sm text-outline hover:bg-ink hover:text-surface focus-visible:bg-ink focus-visible:text-surface focus-visible:outline-none"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
