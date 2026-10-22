import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatLimit } from '#/components/member-card'
import { Modal } from '#/components/modal'
import {
  api,
  ApiError,
  type ProductTree,
  type TreeMember,
  type TreeTask,
} from '#/lib/api'

export type PendingReview = { member: TreeMember; task: TreeTask }

/** ツリー全員のうち、完了報告済み(確認待ち)のタスク。報告日時の古い順(長く待っているものが上) */
export function pendingReviews(tree: ProductTree): PendingReview[] {
  return [tree.leader, ...tree.members]
    .flatMap((member) =>
      member.tasks
        .filter((task) => task.reportedAt)
        .map((task) => ({ member, task })),
    )
    .sort(
      (a, b) =>
        new Date(a.task.reportedAt!).getTime() -
        new Date(b.task.reportedAt!).getTime(),
    )
}

const reportedFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const buttonClass =
  'flex h-9 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60'

// 確認待ち 1 件分の行。成功したらツリーを取り直し、行は消える。
// 404/409 は、行を残してエラーを読めるようにし、押せないままにする(取り直すと行ごと消える)
function ReviewRow({
  productId,
  item,
}: {
  productId: string
  item: PendingReview
}) {
  const { member, task } = item
  // 完了にする前の確認(要件: 完了にするときは確認画面が出る)
  const [confirming, setConfirming] = useState(false)
  const queryClient = useQueryClient()
  const complete = useMutation({
    mutationFn: () =>
      api(`/api/product/${productId}/task/${task.taskId}/complete`, {
        method: 'PATCH',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['products', productId, 'tree'],
      }),
  })
  const stale =
    complete.error instanceof ApiError &&
    (complete.error.status === 404 || complete.error.status === 409)

  return (
    <li className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words">{task.taskName}</p>
          <p className="text-xs opacity-60">
            {member.userName}
            {task.timeLimit && ` / 期限 ${formatLimit(task.timeLimit)}`}
            {` / 報告 ${reportedFormat.format(new Date(task.reportedAt!))}`}
          </p>
          {task.description && (
            <p className="mt-0.5 line-clamp-3 text-xs break-words whitespace-pre-wrap">
              {task.description}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={complete.isPending || stale || confirming}
          onClick={() => setConfirming(true)}
          className={buttonClass}
        >
          完了を確定
        </button>
      </div>
      {confirming && (
        <div className="space-y-2 border-l-2 border-ink pl-3">
          <p>
            「{task.taskName}」を完了にしますか?
            完了にすると、{member.userName} さんの表示から消えます(データは残ります)。
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              autoFocus
              disabled={complete.isPending || stale}
              onClick={() => complete.mutate()}
              className={buttonClass}
            >
              完了にする
            </button>
            <button
              type="button"
              disabled={complete.isPending}
              onClick={() => {
                setConfirming(false)
                complete.reset()
              }}
              className={buttonClass}
            >
              やめる
            </button>
          </div>
        </div>
      )}
      {complete.isError && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
          ERR {complete.error.message}
        </p>
      )}
    </li>
  )
}

// リーダー用。ツリー全員の確認待ち(完了報告済み)のタスクを一覧し、1 件ずつ完了を確定する
export function ReviewDialog({
  productId,
  items,
  open,
  onClose,
}: {
  productId: string
  items: PendingReview[]
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-bold">確認待ち({items.length} 件)</h2>
      {items.length === 0 ? (
        <p className="text-sm">確認待ちはありません</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <ReviewRow key={item.task.taskId} productId={productId} item={item} />
          ))}
        </ul>
      )}
      <button type="button" onClick={onClose} className={buttonClass}>
        閉じる
      </button>
    </Modal>
  )
}
