import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { handleApiError } from '#/lib/session-expired'

export function getContext() {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handleApiError }),
    mutationCache: new MutationCache({ onError: handleApiError }),
  })

  return {
    queryClient,
  }
}
export default function TanstackQueryProvider() {}
