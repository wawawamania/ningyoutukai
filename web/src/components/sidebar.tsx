import { SidebarInvitation } from '#/components/sidebar-invitation'
import type { Invitation } from '#/lib/api'

export type SidebarProduct = { id: string; name: string }

// Figma の `ant-design:plus-outlined`(色は、文字色に追従させる)
function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M7.53125 2.375H8.46875C8.55208 2.375 8.59375 2.41667 8.59375 2.5V13.5C8.59375 13.5833 8.55208 13.625 8.46875 13.625H7.53125C7.44792 13.625 7.40625 13.5833 7.40625 13.5V2.5C7.40625 2.41667 7.44792 2.375 7.53125 2.375Z" />
      <path d="M3 7.40625H13.5C13.5833 7.40625 13.625 7.44792 13.625 7.53125V8.46875C13.625 8.55208 13.5833 8.59375 13.5 8.59375H2.5C2.41667 8.59375 2.375 8.55208 2.375 8.46875V7.53125C2.375 7.44792 2.41667 7.40625 2.5 7.40625H3Z" />
    </svg>
  )
}

// サイドバー(Figma `side-light` / `side-dark`、幅 240px)。角丸は使わない(ユーザーの指定。Figma は 10px)。
// データは、呼び出し側から渡す(api は、ここでは呼ばない)
export function Sidebar({
  products,
  invitations = [],
  activeProductId,
  onSelectProduct,
  onCreateProduct,
  isLoading = false,
}: {
  products: SidebarProduct[]
  // 自分宛ての保留中の招待。1 件以上あるときだけ、「プロダクト」の上に出す
  invitations?: Invitation[]
  activeProductId?: string
  onSelectProduct?: (productId: string) => void
  onCreateProduct?: () => void
  isLoading?: boolean
}) {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-side">
      {/* ロゴ・招待・プロダクト一覧だけがスクロールし、「プロダクト作成」は下に固定する */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-[26px]">
      <p className="text-[28px] leading-normal font-semibold">
        人形使い
      </p>

      {invitations.length > 0 && (
        <section aria-label="招待" className="mt-[26px]">
          <p className="text-sm font-medium">招待({invitations.length})</p>
          <ul className="mt-[7px] flex flex-col gap-4">
            {invitations.map((i) => (
              <SidebarInvitation key={i.invitationId} invitation={i} />
            ))}
          </ul>
        </section>
      )}

      <nav aria-label="プロダクト" className="mt-[26px]">
        <p className="text-sm">プロダクト</p>
        <ul className="mt-[7px] flex flex-col gap-2">
          {isLoading ? (
            <li className="h-12 text-sm leading-[48px] opacity-60">
              読み込み中…
            </li>
          ) : (
            products.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelectProduct?.(p.id)}
                  aria-current={p.id === activeProductId ? 'page' : undefined}
                  className="flex h-12 w-full items-center truncate text-left text-base font-medium hover:bg-side-item aria-[current=page]:bg-side-item"
                >
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </nav>
      </div>

      <div className="shrink-0 px-4 pt-3 pb-6">
        <button
          type="button"
          onClick={() => onCreateProduct?.()}
          className="flex h-12 w-full items-center justify-center gap-3 border border-dashed border-ink text-base font-medium hover:bg-side-item"
        >
          <PlusIcon />
          プロダクト作成
        </button>
      </div>
    </aside>
  )
}
