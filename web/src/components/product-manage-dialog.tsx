import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '#/components/modal'
import { api } from '#/lib/api'
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

function RenameBlock({
  productId,
  productName,
}: {
  productId: string
  productName: string
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(productName)
  const rename = useMutation({
    mutationFn: () =>
      api(`/api/product/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: name.trim() }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['products', productId] })
    },
  })
  const unchanged = name.trim() === productName

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        rename.mutate()
      }}
    >
      <label htmlFor="product-name" className="block text-sm font-bold">
        プロダクト名
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="product-name"
          value={name}
          maxLength={100}
          disabled={rename.isPending}
          onChange={(e) => {
            setName(e.target.value)
            rename.reset()
          }}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={rename.isPending || !name.trim() || unchanged}
          className={buttonClass}
        >
          保存
        </button>
      </div>
      {rename.isSuccess && <p className="text-sm">変更しました</p>}
      {rename.isError && <ErrorText message={rename.error.message} />}
    </form>
  )
}

function DeleteBlock({
  productId,
  productName,
  memberCount,
}: {
  productId: string
  productName: string
  memberCount?: number
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const remove = useMutation({
    mutationFn: () => api(`/api/product/${productId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void navigate({ to: '/home' })
    },
  })

  return (
    <div className="space-y-2 border-t-2 border-ink pt-4">
      <h3 className="text-sm font-bold">危険な操作</h3>
      {confirming ? (
        <div className="space-y-2">
          <p className="break-words text-sm">
            「{productName}」を削除しますか?{' '}
            {memberCount === undefined ? 'メンバー' : `メンバー(${memberCount} 人)`}
            、タスク、招待、タスクの種類が、すべて消えます。元に戻せません
          </p>
          <label htmlFor="delete-confirm" className="block text-sm">
            確認のため、プロダクト名を入力してください
          </label>
          <input
            id="delete-confirm"
            autoFocus
            value={typed}
            disabled={remove.isPending}
            onChange={(e) => setTyped(e.target.value)}
            className={`${inputClass} w-full`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={remove.isPending || typed !== productName}
              onClick={() => remove.mutate()}
              className={buttonClass}
            >
              削除する
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                setConfirming(false)
                setTyped('')
                remove.reset()
              }}
              className={buttonClass}
            >
              やめる
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={buttonClass}
        >
          このプロダクトを削除
        </button>
      )}
      {remove.isError && <ErrorText message={remove.error.message} />}
    </div>
  )
}

// リーダー用。プロダクト名の変更と、プロダクトの削除。開閉は親が制御する
export function ProductManageDialog({
  productId,
  productName,
  memberCount,
  open,
  onClose,
}: {
  productId: string
  productName: string
  /** 知っていれば、削除の確認文にメンバー数を出す */
  memberCount?: number
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-bold">プロダクトの管理</h2>
      <RenameBlock productId={productId} productName={productName} />
      <DeleteBlock
        productId={productId}
        productName={productName}
        memberCount={memberCount}
      />
      <button type="button" onClick={onClose} className={buttonClass}>
        閉じる
      </button>
    </Modal>
  )
}
