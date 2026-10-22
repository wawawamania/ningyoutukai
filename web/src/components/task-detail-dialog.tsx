import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDateTime } from '#/components/member-card'
import { Modal } from '#/components/modal'
import { api, type TreeMember, type TreeTask } from '#/lib/api'

const buttonClass =
  'flex h-9 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none'

export type TaskDetailTarget = { task: TreeTask; member: TreeMember }

function Detail({
  productId,
  target,
  onEdit,
  onClose,
}: {
  productId: string
  target: TaskDetailTarget
  onEdit?: () => void
  onClose: () => void
}) {
  const { task } = target
  const queryClient = useQueryClient()
  const report = useMutation({
    mutationFn: () =>
      api(`/api/product/${productId}/task/${task.taskId}/complete-report`, {
        method: 'POST',
      }),
    // 失敗(409 など)では取り直さない。完了済みでツリーから消えると、エラーを出す前にモーダルごと閉じるため
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['products', productId, 'tree'],
      })
      onClose()
    },
  })

  return (
    <>
      <h2 className="text-lg font-bold break-words">{task.taskName}</h2>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs opacity-60">説明</dt>
          <dd className="break-words whitespace-pre-wrap">
            {task.description || '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs opacity-60">期限</dt>
          <dd>{task.timeLimit ? formatDateTime(task.timeLimit) : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs opacity-60">種類</dt>
          <dd className="break-words">{task.taskType?.taskTypeName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs opacity-60">公開</dt>
          <dd>{task.isVisible ? '公開' : '非公開'}</dd>
        </div>
        <div>
          <dt className="text-xs opacity-60">状態</dt>
          <dd>
            {task.reportedAt
              ? `確認待ち(${formatDateTime(task.reportedAt)} に報告)`
              : '未完了'}
          </dd>
        </div>
      </dl>
      {report.isError && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
          ERR {report.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {!task.reportedAt && (
          <button
            type="button"
            disabled={report.isPending}
            onClick={() => report.mutate()}
            className={buttonClass}
          >
            完了を報告
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            disabled={report.isPending}
            onClick={onEdit}
            className={buttonClass}
          >
            編集
          </button>
        )}
        <button type="button" onClick={onClose} className={buttonClass}>
          閉じる
        </button>
      </div>
    </>
  )
}

// 自分のタスクの詳細のモーダル。未報告なら「完了を報告」を出す(押すとリーダーに通知される)。
// `onEdit` はリーダーにだけ渡す(編集のフォームへ移る)。`target` が null の間は閉じている
export function TaskDetailDialog({
  productId,
  target,
  onEdit,
  onClose,
}: {
  productId: string
  target: TaskDetailTarget | null
  onEdit?: (target: TaskDetailTarget) => void
  onClose: () => void
}) {
  return (
    <Modal open={target !== null} onClose={onClose}>
      {target && (
        <Detail
          key={target.task.taskId}
          productId={productId}
          target={target}
          onEdit={onEdit && (() => onEdit(target))}
          onClose={onClose}
        />
      )}
    </Modal>
  )
}
