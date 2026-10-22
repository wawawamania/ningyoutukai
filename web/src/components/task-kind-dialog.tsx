import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '#/components/modal'
import { api, type TaskKind } from '#/lib/api'
import { errorMessage } from '#/lib/error-message'

const buttonClass =
  'flex h-9 shrink-0 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60'
const inputClass =
  'h-9 min-w-0 flex-1 border-2 border-ink bg-surface px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60'

function ErrorText({ message }: { message: string }) {
  return (
    <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
      ERR {errorMessage(message)}
    </p>
  )
}

// 種類の変更のあとに取り直すクエリ。名前の変更・削除はツリーの taskType 表示にも関わるので、ツリーも取り直す
function useInvalidate(productId: string) {
  const queryClient = useQueryClient()
  return (withTree: boolean) => {
    void queryClient.invalidateQueries({
      queryKey: ['products', productId, 'task_kinds'],
    })
    if (withTree) {
      void queryClient.invalidateQueries({
        queryKey: ['products', productId, 'tree'],
      })
    }
  }
}

// 1 件分の行。通常 / 名前の変更 / 削除の確認(2 段階)の 3 つの表示を切り替える
function KindRow({ productId, kind }: { productId: string; kind: TaskKind }) {
  const invalidate = useInvalidate(productId)
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view')
  const [name, setName] = useState(kind.taskTypeName)
  const base = `/api/product/${productId}/task_kinds/${kind.taskTypeId}`

  const rename = useMutation({
    mutationFn: () =>
      api(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTypeName: name }),
      }),
    onSuccess: () => {
      setMode('view')
      invalidate(true)
    },
  })
  const remove = useMutation({
    mutationFn: () => api(base, { method: 'DELETE' }),
    onSuccess: () => invalidate(true),
  })
  const busy = rename.isPending || remove.isPending
  const error = rename.error ?? remove.error

  return (
    <li className="space-y-2 text-sm">
      {mode === 'edit' ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            rename.mutate()
          }}
        >
          <input
            aria-label="種類の名前"
            value={name}
            maxLength={50}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={busy || !name.trim()} className={buttonClass}>
            保存
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode('view')
              setName(kind.taskTypeName)
              rename.reset()
            }}
            className={buttonClass}
          >
            やめる
          </button>
        </form>
      ) : mode === 'confirm' ? (
        <div className="space-y-2">
          <p className="break-words">
            「{kind.taskTypeName}」を削除しますか? この種類のタスクは「種類なし」になります
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => remove.mutate()}
              className={buttonClass}
            >
              削除する
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('view')
                remove.reset()
              }}
              className={buttonClass}
            >
              やめる
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 break-words">{kind.taskTypeName}</span>
          <button
            type="button"
            onClick={() => {
              setName(kind.taskTypeName)
              setMode('edit')
              remove.reset()
            }}
            className={buttonClass}
          >
            名前を変更
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('confirm')
              rename.reset()
            }}
            className={buttonClass}
          >
            削除
          </button>
        </div>
      )}
      {error && <ErrorText message={error.message} />}
    </li>
  )
}

function AddForm({ productId }: { productId: string }) {
  const invalidate = useInvalidate(productId)
  const [name, setName] = useState('')
  const add = useMutation({
    mutationFn: () =>
      api(`/api/product/${productId}/task_kinds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTypeName: name }),
      }),
    onSuccess: () => {
      setName('')
      invalidate(false)
    },
  })

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
      >
        <input
          aria-label="新しい種類の名前"
          placeholder="新しい種類の名前"
          value={name}
          maxLength={50}
          disabled={add.isPending}
          onChange={(e) => {
            setName(e.target.value)
            add.reset()
          }}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={add.isPending || !name.trim()}
          className={buttonClass}
        >
          追加
        </button>
      </form>
      {add.isError && <ErrorText message={add.error.message} />}
    </div>
  )
}

// リーダー用。タスクの種類の一覧・追加・名前の変更・削除
export function TaskKindDialog({
  productId,
  open,
  onClose,
}: {
  productId: string
  open: boolean
  onClose: () => void
}) {
  const kinds = useQuery({
    queryKey: ['products', productId, 'task_kinds'],
    queryFn: () => api<TaskKind[]>(`/api/product/${productId}/task_kinds`),
    enabled: open,
    retry: false,
  })

  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-bold">種類の管理</h2>
      <AddForm productId={productId} />
      {kinds.isPending ? (
        <p className="text-sm opacity-60">読み込み中…</p>
      ) : kinds.isError ? (
        <ErrorText message={kinds.error.message} />
      ) : kinds.data.length === 0 ? (
        <p className="text-sm">種類はまだありません</p>
      ) : (
        <ul className="space-y-3">
          {kinds.data.map((kind) => (
            <KindRow key={kind.taskTypeId} productId={productId} kind={kind} />
          ))}
        </ul>
      )}
      <button type="button" onClick={onClose} className={buttonClass}>
        閉じる
      </button>
    </Modal>
  )
}
