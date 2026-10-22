import { formatLimit } from '#/components/member-card'
import { Modal } from '#/components/modal'
import type { TreeMember, TreeTask } from '#/lib/api'

// その人の全タスクの一覧(カードには 3 件までしか出ないので、その続きを見る・選ぶ画面)。並びはツリー API の順(期限が近い順)
// `onEditTask` を渡すと、タスク名が押せる(`canOpenTask` があれば、それが true の人のだけ)。閲覧だけなら渡さない
export function TaskListDialog({
  member,
  onClose,
  onEditTask,
  canOpenTask,
}: {
  member: TreeMember | null
  onClose: () => void
  onEditTask?: (member: TreeMember, task: TreeTask) => void
  canOpenTask?: (member: TreeMember) => boolean
}) {
  return (
    <Modal open={member !== null} onClose={onClose}>
      {member && (
        <>
          <h2 className="text-lg font-bold break-words">
            {member.userName} のタスク({member.tasks.length} 件)
          </h2>
          <ul className="space-y-2">
            {member.tasks.map((t) => (
              <li key={t.taskId} className="text-sm">
                <div className="flex items-baseline gap-2">
                  {onEditTask && (canOpenTask?.(member) ?? true) ? (
                    <button
                      type="button"
                      onClick={() => onEditTask(member, t)}
                      className="min-w-0 flex-1 cursor-pointer text-left break-words underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      {t.taskName}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 break-words">
                      {t.taskName}
                    </span>
                  )}
                  {t.timeLimit && (
                    <span className="shrink-0 text-xs">
                      {formatLimit(t.timeLimit)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                  {t.reportedAt && (
                    <span className="shrink-0 border border-ink px-1">
                      確認待ち
                    </span>
                  )}
                  {!t.isVisible && (
                    <span className="shrink-0 border border-ink px-1">
                      非公開
                    </span>
                  )}
                  {t.taskType && (
                    <span className="min-w-0 break-words opacity-60">
                      {t.taskType.taskTypeName}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            閉じる
          </button>
        </>
      )}
    </Modal>
  )
}
