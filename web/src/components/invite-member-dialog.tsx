import { InviteMemberForm } from '#/components/invite-member-form'
import { Modal } from '#/components/modal'

const buttonClass =
  'flex h-9 shrink-0 items-center justify-center border-2 border-outline bg-secondary px-3 text-sm text-outline transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink active:translate-x-0 active:translate-y-0 active:shadow-none'

// 「メンバーを招待」のモーダル(リーダーにだけ出す。開閉は親が持つ)。
// フォームは開いている間だけ置くので、閉じると入力と結果の表示は消える。見た目は暫定(ターミナル風)
export function InviteMemberDialog({
  productId,
  open,
  onClose,
}: {
  productId: string
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <InviteMemberForm productId={productId} />
      <button type="button" onClick={onClose} className={buttonClass}>
        閉じる
      </button>
    </Modal>
  )
}
