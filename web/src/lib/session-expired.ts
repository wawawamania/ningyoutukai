import { ApiError } from '#/lib/api'
import { authClient } from '#/lib/auth-client'

// 多重発火を避けるフラグ。ログインし直したら戻す(`resetSessionExpired`)
let handled = false

/**
 * api が 401 を返したときの共通処理。クライアント側のセッションを破棄して取り直す。
 * 未ログインになると、AppShell が `/` へ戻す(ログイン画面は api を呼ばないので、再発火しない)
 */
export function handleApiError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401 || handled) return
  handled = true
  void authClient
    .signOut()
    .catch(() => {})
    .finally(() => authClient.$store.notify('$sessionSignal'))
}

export function resetSessionExpired() {
  handled = false
}
