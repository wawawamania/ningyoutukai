import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, UIEvent, RefObject } from 'react'
import {
  clampPan,
  clampScale,
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  revealDelta,
  visibleCenter,
  zoomAt,
} from '#/lib/pan-zoom'
import type { Size, View } from '#/lib/pan-zoom'

const DRAG_THRESHOLD = 5
const KEY_STEP = 48
const KEY_STEP_LARGE = 240
const BUTTON_STEP = 1.25

type Point = { x: number; y: number }
type Gesture =
  | { kind: 'drag'; x: number; y: number; view: View; started: boolean }
  | { kind: 'pinch'; dist: number; mid: Point; view: View }

// 領域を、自由にパン(平行移動)とズームができるキャンバスにする
// 状態は View(x, y, scale)。ユーザーが動かすまでは、領域の大きさに合わせた全体表示(fit)を保つ(リサイズにも追従)。動かしたら、その位置と倍率を保つ
// 入力: マウスのドラッグ / タッチの 1 本指 / wheel の二本指スクロール / キー(矢印)で移動、
//   Ctrl・⌘ + wheel(ピンチも ctrlKey 付きの wheel で来る)/ タッチの 2 本指ピンチ / キー(+ - 0)/ ボタンでズーム
// 5px 未満の動きはクリック扱い(カードのボタンはそのまま押せる)。動かしたあとの解放では、click を捨てる
export function usePanZoom(
  containerRef: RefObject<HTMLElement | null>,
  size: Size | null,
) {
  const [user, setUser] = useState<View | null>(null)
  const [dragging, setDragging] = useState(false)
  const fit = size ? fitView(size) : null
  const view = user ?? fit

  // イベントの処理は、最新の値を ref から読む(同じフレームで複数のイベントが来ても、取りこぼさない)
  const viewRef = useRef(view)
  viewRef.current = view
  const sizeRef = useRef(size)
  sizeRef.current = size
  const fitScaleRef = useRef(fit?.scale ?? 1)
  fitScaleRef.current = fit?.scale ?? 1
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const moved = useRef(false)

  const commit = (next: View) => {
    const s = sizeRef.current
    if (!s) return
    const v = clampPan(next, s)
    viewRef.current = v
    setUser(v)
  }
  const zoomTo = (scale: number, p?: Point) => {
    const s = sizeRef.current
    const v = viewRef.current
    if (!s || !v) return
    const at = p ?? visibleCenter(s, v)
    commit(zoomAt(v, at, scale, s, fitScaleRef.current))
  }
  const panBy = (dx: number, dy: number) => {
    const v = viewRef.current
    if (v) commit({ ...v, x: v.x + dx, y: v.y + dy })
  }
  const reset = () => {
    viewRef.current = fit
    setUser(null)
  }

  // wheel: Ctrl/⌘ ありはカーソルを中心にズーム、なしは二本指スクロールでパン
  // passive だと preventDefault できないので、直接つける(領域の上だけ。ページの縦スクロールは領域の外で)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const v = viewRef.current
      if (!v) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const p = {
          x: e.clientX - rect.left - el.clientLeft,
          y: e.clientY - rect.top - el.clientTop,
        }
        // ピンチは細かい deltaY が連続で来るので、ホイールの 1 目盛り(大きい値)より強くかける
        const k = Math.abs(e.deltaY) >= 50 ? 0.002 : 0.01
        zoomTo(v.scale * Math.exp(-e.deltaY * k), p)
        return
      }
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      panBy(-e.deltaX * unit, -e.deltaY * unit)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // zoomTo / panBy は ref と setState だけを使うので、つけ直さなくてよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef])

  const pinchState = (el: HTMLElement) => {
    const [a, b] = [...pointers.current.values()]
    const rect = el.getBoundingClientRect()
    return {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: {
        x: (a.x + b.x) / 2 - rect.left - el.clientLeft,
        y: (a.y + b.y) / 2 - rect.top - el.clientTop,
      },
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const v = viewRef.current
    if (!v || (e.pointerType === 'mouse' && e.button !== 0)) return
    if (pointers.current.size >= 2) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      gesture.current = {
        kind: 'drag',
        x: e.clientX,
        y: e.clientY,
        view: v,
        started: false,
      }
      moved.current = false
    } else {
      // 2 本目の指で、ピンチに切り替える
      const el = e.currentTarget
      for (const id of pointers.current.keys()) el.setPointerCapture(id)
      gesture.current = { kind: 'pinch', ...pinchState(el), view: v }
      moved.current = true
      setDragging(true)
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      const now = pinchState(e.currentTarget)
      const scale = clampScale(
        (g.view.scale * now.dist) / g.dist,
        fitScaleRef.current,
      )
      // ピンチの開始時の中点の下にあった中身の点を、いまの中点の下に置く
      const cx = (g.mid.x - g.view.x) / g.view.scale
      const cy = (g.mid.y - g.view.y) / g.view.scale
      commit({ scale, x: now.mid.x - cx * scale, y: now.mid.y - cy * scale })
      return
    }
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.started) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      g.started = true
      moved.current = true
      setDragging(true)
      // キャプチャは動かし始めてから(先にすると、ボタンへの click が届かなくなる)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    commit({ ...g.view, x: g.view.x + dx, y: g.view.y + dy })
  }
  const end = (e: PointerEvent<HTMLElement>) => {
    if (!pointers.current.delete(e.pointerId)) return
    const rest = [...pointers.current.values()]
    if (rest.length === 1 && viewRef.current) {
      // ピンチから 1 本指に戻ったら、そのままドラッグを続ける
      gesture.current = {
        kind: 'drag',
        x: rest[0].x,
        y: rest[0].y,
        view: viewRef.current,
        started: true,
      }
      return
    }
    if (rest.length > 0) return
    gesture.current = null
    setDragging(false)
    // click が来なかった場合に備えて、少しあとで戻す
    setTimeout(() => {
      moved.current = false
    }, 0)
  }
  const onClickCapture = (e: MouseEvent) => {
    if (moved.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  // キーボード(Tab)でフォーカスが画面外の要素に移ったら、見える位置まで動かす(ズームはしない)
  // マウスで押したときのフォーカス(:focus-visible でない)では動かさない
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const el = e.currentTarget
    const t = e.target
    if (t === el || !(t instanceof HTMLElement)) return
    try {
      if (!t.matches(':focus-visible')) return
    } catch {
      return
    }
    const a = el.getBoundingClientRect()
    const r = t.getBoundingClientRect()
    const ox = a.left + el.clientLeft
    const oy = a.top + el.clientTop
    const { dx, dy } = revealDelta(
      { left: r.left - ox, top: r.top - oy, right: r.right - ox, bottom: r.bottom - oy },
      { width: el.clientWidth, height: el.clientHeight },
      undefined,
      { top: sizeRef.current?.top, bottom: sizeRef.current?.bottom },
    )
    if (dx !== 0 || dy !== 0) panBy(dx, dy)
  }
  // overflow: clip でも、念のため(clip 非対応のブラウザ向け)ネイティブのスクロールで生じたずれを戻す
  const onScroll = (e: UIEvent<HTMLElement>) => {
    e.currentTarget.scrollLeft = 0
    e.currentTarget.scrollTop = 0
  }
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return
    const v = viewRef.current
    if (!v) return
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    switch (e.key) {
      case 'ArrowLeft':
        panBy(step, 0)
        break
      case 'ArrowRight':
        panBy(-step, 0)
        break
      case 'ArrowUp':
        panBy(0, step)
        break
      case 'ArrowDown':
        panBy(0, -step)
        break
      case '+':
      case '=':
        zoomTo(v.scale * BUTTON_STEP)
        break
      case '-':
        zoomTo(v.scale / BUTTON_STEP)
        break
      case '0':
        reset()
        break
      default:
        return
    }
    e.preventDefault()
  }

  const fitScale = fit?.scale ?? 1
  return {
    view,
    dragging,
    canZoomIn: !!view && view.scale < MAX_ZOOM * fitScale * 0.999,
    canZoomOut: !!view && view.scale > MIN_ZOOM * fitScale * 1.001,
    zoomIn: () => view && zoomTo(view.scale * BUTTON_STEP),
    zoomOut: () => view && zoomTo(view.scale / BUTTON_STEP),
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture,
      onKeyDown,
      onFocus,
      onScroll,
    },
  }
}
