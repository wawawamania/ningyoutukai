const buttonClass =
  'flex h-7 min-w-7 items-center justify-center border border-ink px-2 text-sm hover:bg-side-item disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent'

// ツリーの拡大・縮小の操作バー。percent は、いま画面に出ている倍率(%)。拡大縮小は、領域の中央を中心にする
// 全体表示は、位置も倍率も、最初の全体が収まる状態に戻す
export function TreeZoomBar({
  percent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  percent: number
  canZoomIn: boolean
  canZoomOut: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-1 border border-ink/30 bg-surface/80 p-1 text-sm">
      <span className="w-12 text-right tabular-nums opacity-60">
        {percent}%
      </span>
      <button
        type="button"
        aria-label="縮小"
        title="縮小(-)"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        className={buttonClass}
      >
        −
      </button>
      <button
        type="button"
        aria-label="拡大"
        title="拡大(+)"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        className={buttonClass}
      >
        ＋
      </button>
      <button
        type="button"
        aria-label="全体を表示"
        title="全体を表示(0)"
        onClick={onReset}
        className={buttonClass}
      >
        全体表示
      </button>
    </div>
  )
}
