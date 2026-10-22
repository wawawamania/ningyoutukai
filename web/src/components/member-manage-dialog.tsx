import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Modal } from '#/components/modal'
import { api, ApiError, type ProductTree, type TreeMember } from '#/lib/api'

const roleLabel = { leader: 'リーダー', member: 'メンバー' } as const

const buttonClass =
  'flex h-9 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60'

// メンバー 1 人分の行。リーダーが role=member の行で「外す」を押すと、同じ行で確認を出す。
// 成功したらツリーを取り直し、行は消える。失敗(404/403 など)は行を残し、取り直さない
// (取り直すと行ごと消えてエラーが読めない)。404 は押せないままにする
function MemberRow({
  productId,
  member,
  canRemove,
}: {
  productId: string
  member: TreeMember
  canRemove: boolean
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: () =>
      api<void>(`/api/product/${productId}/member/${member.productMemberId}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['products', productId, 'tree'],
      }),
  })
  const gone = remove.error instanceof ApiError && remove.error.status === 404
  const count = member.tasks.length

  return (
    <li className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {member.avatarUrl ? (
          <img
            src={member.avatarUrl}
            alt=""
            className="size-8 shrink-0 border-2 border-current object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center border-2 border-current font-bold"
          >
            {[...member.userName][0] ?? '?'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-bold break-words">{member.userName}</p>
          <p className="text-xs opacity-60">
            {roleLabel[member.role]} / タスク {count} 件
          </p>
        </div>
        {canRemove && !confirming && (
          <button
            type="button"
            disabled={gone}
            onClick={() => setConfirming(true)}
            className={buttonClass}
          >
            外す
          </button>
        )}
      </div>
      {canRemove && confirming && (
        <div className="space-y-2 border-l-2 border-ink pl-3">
          <p>
            {member.userName} を外しますか?
            {count > 0 && ` 担当の ${count} 件のタスクも消えます`}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={remove.isPending || gone}
              onClick={() => remove.mutate()}
              className={buttonClass}
            >
              外す(確定)
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                setConfirming(false)
                remove.reset()
              }}
              className={buttonClass}
            >
              やめる
            </button>
          </div>
        </div>
      )}
      {remove.isError && (
        <p role="alert" className="border-l-2 border-ink pl-3">
          ERR {remove.error.message}
        </p>
      )}
    </li>
  )
}

// メンバー管理。全員が一覧を見られ、リーダーだけメンバーを外せる。
// 一覧はツリー(担当タスクの件数も入っている)から出すので、追加の通信はない
export function MemberManageDialog({
  productId,
  tree,
  isLeader,
  open,
  onClose,
}: {
  productId: string
  tree: ProductTree
  isLeader: boolean
  open: boolean
  onClose: () => void
}) {
  const members = [tree.leader, ...tree.members]
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-bold">メンバー({members.length} 人)</h2>
      <ul className="space-y-4">
        {members.map((m) => (
          <MemberRow
            key={m.productMemberId}
            productId={productId}
            member={m}
            canRemove={isLeader && m.role === 'member'}
          />
        ))}
      </ul>
      <button type="button" onClick={onClose} className={buttonClass}>
        閉じる
      </button>
    </Modal>
  )
}
