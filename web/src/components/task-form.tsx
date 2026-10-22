import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  ApiError,
  type TaskKind,
  type TreeMember,
  type TreeTask,
} from '#/lib/api'
import { errorMessage } from '#/lib/error-message'

// 期限は日本時間(+09:00)として扱う。`datetime-local` の値(`2026-12-01T09:00`)と ISO を行き来する
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** ISO の日時を、日本時間の `datetime-local` の値にする */
function toInputValue(iso: string | null): string {
  if (!iso) return ''
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
}

/** `datetime-local` の値(日本時間)を、api に送る ISO 8601 にする */
function toIso(value: string): string {
  return `${value}${value.length === 16 ? ':00' : ''}+09:00`
}

const fieldClass =
  'w-full border-2 border-ink bg-surface px-3 font-mono text-[16px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60'
const buttonClass =
  'flex h-10 shrink-0 items-center justify-center border-2 border-outline bg-secondary px-4 text-sm text-outline transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none'

type Props = {
  productId: string
  /** ツリーのリーダーとメンバー(担当者の選択肢) */
  members: TreeMember[]
  /** 渡すと編集、なければ作成。編集では担当者は変えられない(表示のみ) */
  edit?: { task: TreeTask; member: TreeMember }
  /** 成功したとき(モーダルを閉じる) */
  onDone: () => void
}

// タスクの作成と編集のフォーム(リーダーにだけ出す)。見た目は暫定(ターミナル風)
export function TaskForm({ productId, members, edit, onDone }: Props) {
  const queryClient = useQueryClient()
  const initial = edit?.task
  const [taskName, setTaskName] = useState(initial?.taskName ?? '')
  const [memberId, setMemberId] = useState(
    edit?.member.productMemberId ?? members[0]?.productMemberId ?? '',
  )
  const [description, setDescription] = useState(initial?.description ?? '')
  const [timeLimit, setTimeLimit] = useState(toInputValue(initial?.timeLimit ?? null))
  const [kindId, setKindId] = useState(initial?.taskType?.taskTypeId ?? '')
  const [isVisible, setIsVisible] = useState(initial?.isVisible ?? true)

  const kinds = useQuery({
    queryKey: ['products', productId, 'task_kinds'],
    queryFn: () => api<TaskKind[]>(`/api/product/${productId}/task_kinds`),
    retry: false,
  })

  const save = useMutation({
    mutationFn: async () => {
      const json = { 'Content-Type': 'application/json' }
      if (!initial) {
        // 作成: 空の項目は送らない
        await api(`/api/product/${productId}/task`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({
            taskName: taskName.trim(),
            productMemberId: memberId,
            ...(description !== '' && { description }),
            ...(timeLimit !== '' && { timeLimit: toIso(timeLimit) }),
            ...(kindId !== '' && { taskTypeId: kindId }),
            isVisible,
          }),
        })
        return
      }
      // 編集: 変更した項目だけ送る(期限と説明は、空にすると null で消す)
      const changes: Record<string, unknown> = {}
      if (taskName.trim() !== initial.taskName) changes.taskName = taskName.trim()
      if (description !== (initial.description ?? '')) changes.description = description
      if (timeLimit !== toInputValue(initial.timeLimit)) {
        changes.timeLimit = timeLimit === '' ? null : toIso(timeLimit)
      }
      if (isVisible !== initial.isVisible) changes.isVisible = isVisible
      const base = `/api/product/${productId}/task/${initial.taskId}`
      if (Object.keys(changes).length > 0) {
        await api(base, { method: 'PATCH', headers: json, body: JSON.stringify(changes) })
      }
      // 種類は別の api。割り当てのみで、外す(なしに戻す)api はないので、選んだときだけ呼ぶ
      if (kindId !== '' && kindId !== (initial.taskType?.taskTypeId ?? '')) {
        await api(`${base}/task_kinds/${kindId}`, { method: 'PATCH' })
      }
    },
    onSuccess: onDone,
    // 途中まで成功していても、ツリーは最新にしておく
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['products', productId, 'tree'] }),
  })

  // 削除は 2 段階(「削除」→ 確認)。404 は、すでに消えているので、閉じるだけでよい
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const remove = useMutation({
    mutationFn: () =>
      api<void>(`/api/product/${productId}/task/${initial?.taskId}`, { method: 'DELETE' }),
    onSuccess: onDone,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 404) onDone()
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['products', productId, 'tree'] }),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (save.isPending || remove.isPending) return
    save.reset()
    save.mutate()
  }

  const heading = initial ? 'タスクを編集' : 'タスクを追加'
  const assignee = edit?.member
  const hasKind = Boolean(initial?.taskType)

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-sm font-bold">{heading}</h2>

      <div className="space-y-1">
        <label htmlFor="task-name" className="block text-sm font-bold">
          タスク名
        </label>
        <input
          id="task-name"
          type="text"
          required
          maxLength={200}
          autoComplete="off"
          value={taskName}
          disabled={save.isPending}
          onChange={(e) => {
            setTaskName(e.target.value)
            // 空白だけは、必須の入力として通らないようにする
            e.target.setCustomValidity(
              e.target.value.trim() === '' ? 'タスク名を入力してください' : '',
            )
          }}
          className={`${fieldClass} h-10`}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="task-assignee" className="block text-sm font-bold">
          担当者
        </label>
        {assignee ? (
          <p id="task-assignee" className="text-sm">
            {assignee.userName}(変更できません)
          </p>
        ) : (
          <select
            id="task-assignee"
            required
            value={memberId}
            disabled={save.isPending}
            onChange={(e) => setMemberId(e.target.value)}
            className={`${fieldClass} h-10`}
          >
            {members.map((m) => (
              <option key={m.productMemberId} value={m.productMemberId}>
                {m.userName}
                {m.role === 'leader' ? '(リーダー)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="task-description" className="block text-sm font-bold">
          説明
        </label>
        <textarea
          id="task-description"
          rows={4}
          maxLength={5000}
          value={description}
          disabled={save.isPending}
          onChange={(e) => setDescription(e.target.value)}
          className={`${fieldClass} py-2`}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="task-time-limit" className="block text-sm font-bold">
          期限(日本時間)
        </label>
        <input
          id="task-time-limit"
          type="datetime-local"
          min="2000-01-01T00:00"
          max="2100-12-31T23:59"
          value={timeLimit}
          disabled={save.isPending}
          onChange={(e) => setTimeLimit(e.target.value)}
          className={`${fieldClass} h-10`}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="task-kind" className="block text-sm font-bold">
          種類
        </label>
        <select
          id="task-kind"
          value={kindId}
          disabled={save.isPending || kinds.isPending}
          onChange={(e) => setKindId(e.target.value)}
          className={`${fieldClass} h-10`}
        >
          {/* 種類を外す api はないので、すでに種類があるタスクでは「なし」を出さない */}
          {!hasKind && <option value="">なし</option>}
          {kinds.data?.map((k) => (
            <option key={k.taskTypeId} value={k.taskTypeId}>
              {k.taskTypeName}
            </option>
          ))}
        </select>
        {kinds.isError && (
          <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
            ERR {kinds.error.message}
          </p>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm font-bold">
        <input
          type="checkbox"
          checked={isVisible}
          disabled={save.isPending}
          onChange={(e) => setIsVisible(e.target.checked)}
          className="size-4 accent-ink"
        />
        他のメンバーに公開する
      </label>

      {save.isError && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
          ERR {errorMessage(save.error.message)}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={save.isPending || remove.isPending}
          className={buttonClass}>
          {save.isPending ? '送信中…' : initial ? '保存' : '追加'}
        </button>
        <button
          type="button"
          disabled={save.isPending || remove.isPending}
          onClick={onDone}
          className={buttonClass}
        >
          閉じる
        </button>
      </div>

      {initial && (
        <div className="space-y-3 border-t-2 border-ink pt-4">
          {remove.isError && (
            <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
              ERR {remove.error.message}
            </p>
          )}
          {confirmingRemove ? (
            <>
              <p className="text-sm font-bold">
                「{initial.taskName}」を削除しますか? 元に戻せません
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={remove.isPending || save.isPending}
                  onClick={() => {
                    remove.reset()
                    remove.mutate()
                  }}
                  className={buttonClass}
                >
                  {remove.isPending ? '削除中…' : '削除する'}
                </button>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.reset()
                    setConfirmingRemove(false)
                  }}
                  className={buttonClass}
                >
                  やめる
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => setConfirmingRemove(true)}
              className={buttonClass}
            >
              このタスクを削除
            </button>
          )}
        </div>
      )}
    </form>
  )
}
