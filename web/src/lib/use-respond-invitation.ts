import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '#/lib/api'

// 招待の承認・拒否。成功したら一覧を取り直す(承認したら、プロダクト一覧も)。
// `stale`: 404/409 はその招待がもう無効なので、押せないままにするための印
export function useRespondInvitation(invitationId: string) {
  const queryClient = useQueryClient()
  const respond = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api(`/api/invitation/${invitationId}/${action}`, { method: 'POST' }),
    onSuccess: (_data, action) => {
      if (action === 'accept')
        void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['invitations'] })
    },
  })
  const stale =
    respond.error instanceof ApiError &&
    (respond.error.status === 404 || respond.error.status === 409)
  return { respond, stale }
}
