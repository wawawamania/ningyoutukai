import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AppShell } from '#/components/app-shell'
import { InviteMemberDialog } from '#/components/invite-member-dialog'
import { ManageMenu, type ManageMenuItem } from '#/components/manage-menu'
import { MemberManageDialog } from '#/components/member-manage-dialog'
import { ProductManageDialog } from '#/components/product-manage-dialog'
import { TaskKindDialog } from '#/components/task-kind-dialog'
import { ProductTree } from '#/components/product-tree'
import { pendingReviews, ReviewDialog } from '#/components/review-dialog'
import {
  TaskDetailDialog,
  type TaskDetailTarget,
} from '#/components/task-detail-dialog'
import { TaskListDialog } from '#/components/task-list-dialog'
import {
  TaskFormDialog,
  type TaskFormTarget,
} from '#/components/task-form-dialog'
import {
  api,
  type ProductSummary,
  type ProductTree as ProductTreeData,
  type TreeMember,
  type TreeTask,
} from '#/lib/api'

// プロダクトの画面(`/products/$productId`)。ログイン必須。見出しと、ツリー(リーダーとメンバー、タスク)
// 見た目は暫定(ターミナル風)。Figma の `tree` の設計ができたら入れ替える
export const Route = createFileRoute('/products/$productId')({
  component: Product,
})

const roleLabel = { leader: 'リーダー', member: 'メンバー' } as const

function Product() {
  const { productId } = Route.useParams()
  const navigate = useNavigate()
  const [taskForm, setTaskForm] = useState<TaskFormTarget | null>(null)
  // 自分のタスクの詳細(完了報告)を開いているタスク。再取得で最新になるよう、id で持つ
  const [detailId, setDetailId] = useState<string | null>(null)
  // 全タスクの一覧を開いている人(再取得で最新になるよう、id で持つ)
  const [listMemberId, setListMemberId] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [kindsOpen, setKindsOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [productManageOpen, setProductManageOpen] = useState(false)
  const product = useQuery({
    queryKey: ['products', productId],
    queryFn: () => api<ProductSummary>(`/api/product/${productId}`),
    retry: false,
  })
  const tree = useQuery({
    queryKey: ['products', productId, 'tree'],
    queryFn: () => api<ProductTreeData>(`/api/product/${productId}/tree`),
    retry: false,
  })

  const isLeader = product.data?.role === 'leader'
  // 「管理」メニューの項目。足すときは 1 行足す(リーダーだけなら isLeader の側に)
  const manageItems: ManageMenuItem[] = [
    { label: 'メンバー', onSelect: () => setMembersOpen(true) },
    ...(isLeader
      ? [
          { label: 'タスクの種類', onSelect: () => setKindsOpen(true) },
          { label: 'メンバーを招待', onSelect: () => setInviteOpen(true) },
          { label: 'プロダクト管理', onSelect: () => setProductManageOpen(true) },
        ]
      : []),
  ]
  const myId = tree.data?.viewerProductMemberId
  // 自分のタスクは詳細(リーダーも。編集は詳細から)、他人のタスクはリーダーだけ編集
  const canOpenTask = (m: TreeMember) => isLeader || m.productMemberId === myId
  const openTask = (member: TreeMember, task: TreeTask) => {
    setListMemberId(null)
    if (member.productMemberId === myId) setDetailId(task.taskId)
    else setTaskForm({ edit: { task, member } })
  }
  const detail: TaskDetailTarget | null = tree.data
    ? [tree.data.leader, ...tree.data.members].reduce<TaskDetailTarget | null>(
        (found, member) => {
          const task = member.tasks.find((t) => t.taskId === detailId)
          return found ?? (task ? { task, member } : null)
        },
        null,
      )
    : null

  // 見出しと右のボタン群。キャンバスの上に重ねる(ボタンのところだけ操作できる)
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-48 flex-1">
        {product.isPending ? (
          <p className="text-sm opacity-60">読み込み中…</p>
        ) : product.isError ? (
          <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
            ERR {product.error.message}
          </p>
        ) : (
          <>
            <h1 className="text-2xl font-bold break-words">
              {product.data.productName}
            </h1>
            <p className="mt-1 text-sm opacity-70">
              {roleLabel[product.data.role]}
            </p>
          </>
        )}
      </div>
      <div className="pointer-events-auto flex flex-wrap items-center gap-3">
        {tree.data && <ManageMenu items={manageItems} />}
        {product.data?.role === 'leader' && (
          <>
            <button
              type="button"
              onClick={() => setTaskForm({})}
              className="flex h-9 shrink-0 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none"
            >
              タスクを追加
            </button>
            {tree.data && (
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="flex h-9 shrink-0 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none"
              >
                確認待ち {pendingReviews(tree.data).length} 件
              </button>
            )}
          </>
        )}
      <button
        type="button"
        onClick={() => void navigate({ to: '/home' })}
        className="flex h-9 shrink-0 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none"
      >
        ホームへ戻る
      </button>
      </div>
    </div>
  )

  return (
    <AppShell activeProductId={productId} align="full">
      {() => (
        <div className="relative h-full min-w-0">
          {product.isError || product.isPending || tree.isPending || tree.isError ? (
            <div className="space-y-6 p-4">
              {header}
              {product.isError ? null : product.isPending || tree.isPending ? (
                <p className="text-sm opacity-60">読み込み中…</p>
              ) : tree.isError ? (
                <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
                  ERR {tree.error.message}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <ProductTree
                key={productId}
                header={header}
                tree={tree.data}
                onEditTask={openTask}
                canOpenTask={canOpenTask}
                onShowTasks={(member) => setListMemberId(member.productMemberId)}
              />
            <TaskListDialog
              member={
                [tree.data.leader, ...tree.data.members].find(
                  (m) => m.productMemberId === listMemberId,
                ) ?? null
              }
              onClose={() => setListMemberId(null)}
              onEditTask={openTask}
              canOpenTask={canOpenTask}
            />
            <TaskDetailDialog
              productId={productId}
              target={detail}
              onEdit={
                isLeader
                  ? ({ task, member }) => {
                      setDetailId(null)
                      setTaskForm({ edit: { task, member } })
                    }
                  : undefined
              }
              onClose={() => setDetailId(null)}
            />
            <MemberManageDialog
              productId={productId}
              tree={tree.data}
              isLeader={isLeader}
              open={membersOpen}
              onClose={() => setMembersOpen(false)}
            />
            {isLeader && (
              <>
                <TaskKindDialog
                  productId={productId}
                  open={kindsOpen}
                  onClose={() => setKindsOpen(false)}
                />
                <InviteMemberDialog
                  productId={productId}
                  open={inviteOpen}
                  onClose={() => setInviteOpen(false)}
                />
                <ProductManageDialog
                  productId={productId}
                  productName={
                    product.data?.productName ?? tree.data.product.productName
                  }
                  memberCount={tree.data.members.length + 1}
                  open={productManageOpen}
                  onClose={() => setProductManageOpen(false)}
                />
              </>
            )}
            {product.data?.role === 'leader' && (
              <ReviewDialog
                productId={productId}
                items={pendingReviews(tree.data)}
                open={reviewOpen}
                onClose={() => setReviewOpen(false)}
              />
            )}
            {product.data?.role === 'leader' && (
              <TaskFormDialog
                productId={productId}
                members={[tree.data.leader, ...tree.data.members]}
                target={taskForm}
                onClose={() => setTaskForm(null)}
              />
            )}
            </>
          )}
        </div>
      )}
    </AppShell>
  )
}
