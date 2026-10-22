import { Modal } from '#/components/modal'
import { TaskForm } from '#/components/task-form'
import type { TreeMember, TreeTask } from '#/lib/api'

/** 開くフォーム。`edit` があれば編集、なければ作成 */
export type TaskFormTarget = { edit?: { task: TreeTask; member: TreeMember } }

// タスクの作成・編集のモーダル(リーダーにだけ出す)。`target` が null の間は閉じている。
// 編集の対象が変わったら作り直すよう、`key` にタスクの id を使う
export function TaskFormDialog({
  productId,
  members,
  target,
  onClose,
}: {
  productId: string
  members: TreeMember[]
  target: TaskFormTarget | null
  onClose: () => void
}) {
  return (
    <Modal open={target !== null} onClose={onClose}>
      {target && (
        <TaskForm
          key={target.edit?.task.taskId ?? 'new'}
          productId={productId}
          members={members}
          edit={target.edit}
          onDone={onClose}
        />
      )}
    </Modal>
  )
}
