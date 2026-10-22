import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Size } from '#/lib/pan-zoom'

// 領域(container)と中身(content)の大きさを測り、リサイズに追従する
// 中身は、倍率をかける前の自然な大きさ(offsetWidth / offsetHeight は transform の影響を受けない)
// 測定前(サーバー描画・初回)は null を返すので、呼び出し側は中身を隠しておく
// top / bottom: 領域に重ねている見出し・操作バーの高さ(全体表示で避ける)
export function useCanvasSize(top = 0, bottom = 0) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [measured, setMeasured] = useState<Size | null>(null)

  const measure = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    const next = {
      cw: container.clientWidth,
      ch: container.clientHeight,
      w: content.offsetWidth,
      h: content.offsetHeight,
    }
    if (next.w === 0 || next.h === 0 || next.cw === 0 || next.ch === 0) return
    setMeasured((prev) =>
      prev &&
      prev.cw === next.cw &&
      prev.ch === next.ch &&
      prev.w === next.w &&
      prev.h === next.h
        ? prev
        : next,
    )
  }, [])

  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (containerRef.current) observer.observe(containerRef.current)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [measure])

  const size = useMemo(
    () => (measured ? { ...measured, top, bottom } : null),
    [measured, top, bottom],
  )
  return { containerRef, contentRef, size }
}
