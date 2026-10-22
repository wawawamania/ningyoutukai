import { useEffect, useRef } from 'react'

// 共通のモーダル(`dialog`)。`open` の間だけ中身を置くので、閉じると入力の状態は消える。
// 余白は中の div 側に持たせ、背景(dialog 自体)を押したときだけ閉じる。見た目は暫定(ターミナル風)
export function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // 開く直前にフォーカスされていた要素。閉じたら戻す(消えていたら何もしない)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      returnTo.current = document.activeElement as HTMLElement | null
      dialog.showModal()
    }
    if (!open) {
      if (dialog.open) dialog.close()
      if (returnTo.current?.isConnected) returnTo.current.focus()
      returnTo.current = null
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // 外側(背景)を押したら閉じる。dialog 自体が押されたときだけ(余白は中の div 側なので、中身は押しても閉じない)
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] border-2 border-ink bg-surface text-ink backdrop:bg-black/40"
    >
      {open && <div className="space-y-4 p-6">{children}</div>}
    </dialog>
  )
}
