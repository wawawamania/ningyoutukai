/**
 * api(Elysia)のベース URL。認証(`auth-client.ts`)と、通常の API 呼び出しで共通。
 * 未設定なら開発用の `http://localhost:3001`。**空文字(`VITE_API_URL=`)なら同一オリジンの相対パス**
 * (本番の案 S: web の Worker が `/api/*` を api に転送する。`src/worker.ts`、docs/deploy.md)。
 * `??` は空文字を通すので、空にすればそのまま相対パスになる。better-auth のクライアントも、
 * baseURL が空なら `window.location.origin` を使う。
 */
export const API_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/** api が返すエラーの形(すべて `{ message }`) */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * api を、ログインの cookie 付きで呼ぶ。失敗したら、`ApiError`(`message` は、画面に出せる文)を投げる。
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { credentials: 'include', ...init })
  } catch {
    throw new ApiError(0, 'サーバーに接続できませんでした。時間をおいて、もう一度お試しください')
  }
  if (!res.ok) {
    let message = 'エラーが発生しました'
    try {
      const body = (await res.json()) as { message?: unknown }
      if (typeof body.message === 'string') message = body.message
    } catch {
      // 本文が JSON でなければ、既定の文のまま
    }
    throw new ApiError(res.status, message)
  }
  // 204(本文なし)は undefined を返す
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** `GET /api/product`(自分が所属するプロダクトの一覧)の 1 件 */
export type ProductSummary = {
  productId: string
  productName: string
  createdAt: string
  role: 'leader' | 'member'
}

/** `GET /api/product/:productId/tree` のタスク 1 件 */
export type TreeTask = {
  taskId: string
  taskName: string
  description: string | null
  /** ISO 8601。期限なしは null */
  timeLimit: string | null
  /** 値があれば、完了報告済み(リーダーの確認待ち) */
  reportedAt: string | null
  isVisible: boolean
  taskType: { taskTypeId: string; taskTypeName: string } | null
}

/** ツリーの 1 人分(リーダーかメンバー)。`tasks` は期限が近い順 */
export type TreeMember = {
  productMemberId: string
  userId: string
  userName: string
  avatarUrl: string | null
  role: 'leader' | 'member'
  tasks: TreeTask[]
}

/** `GET /api/product/:productId/tree` の応答 */
export type ProductTree = {
  product: { productId: string; productName: string }
  leader: TreeMember
  members: TreeMember[]
  /** 呼び出したユーザー自身の productMemberId(自分のタスクの判定に使う) */
  viewerProductMemberId: string
}

/** `GET /api/product/:productId/task_kinds`(タスクの種類の一覧)の 1 件 */
export type TaskKind = {
  taskTypeId: string
  taskTypeName: string
  productId: string
}

/** `GET /api/invitation`(自分宛ての保留中の招待)の 1 件 */
export type Invitation = {
  invitationId: string
  productId: string
  productName: string
  leaderNames: string[]
  createdAt: string
}
