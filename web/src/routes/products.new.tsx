import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AppShell } from '#/components/app-shell'
import { Prompt, Terminal } from '#/components/terminal'
import { api, type ProductSummary } from '#/lib/api'
import { errorMessage } from '#/lib/error-message'

// プロダクト作成(`/products/new`)。ログイン必須。仮の見た目(ターミナル風)
export const Route = createFileRoute('/products/new')({
  component: NewProduct,
})

const buttonBase =
  'flex h-[48px] items-center justify-center border-2 px-4 text-[16px] transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none'

function NewProduct() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting.current) return
    const productName = name.trim()
    if (productName === '') {
      setError('プロダクト名を入力してください')
      return
    }
    if (productName.length > 100) {
      setError('プロダクト名は 100 文字以内で入力してください')
      return
    }
    submitting.current = true
    setPending(true)
    setError(null)
    let created: ProductSummary
    try {
      created = await api<ProductSummary>('/api/product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
      submitting.current = false
      setPending(false)
      return
    }
    void queryClient.invalidateQueries({ queryKey: ['products'] })
    void navigate({
      to: '/products/$productId',
      params: { productId: created.productId },
    })
  }

  return (
    <AppShell>
      {() => (
        <Terminal title="~/ningyoutukai — new product">
          <Prompt>mkdir product</Prompt>
          <form onSubmit={(e) => void submit(e)} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="product-name" className="block text-sm">
                プロダクト名
              </label>
              <input
                id="product-name"
                type="text"
                autoFocus
                autoComplete="off"
                value={name}
                readOnly={pending}
                onChange={(e) => setName(e.target.value)}
                className="h-12 w-full border-2 border-ink bg-surface px-3 font-mono text-[16px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink read-only:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={pending}
                className={`${buttonBase} flex-1 border-primary bg-primary text-on-primary`}
              >
                {pending ? '作成中…' : '作成'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => void navigate({ to: '/home' })}
                className={`${buttonBase} border-outline bg-secondary text-outline sm:w-40`}
              >
                キャンセル
              </button>
            </div>
            {error && (
              <p role="alert" className="border-l-2 border-ink pl-3 text-sm">
                ERR {errorMessage(error)}
              </p>
            )}
          </form>
        </Terminal>
      )}
    </AppShell>
  )
}
