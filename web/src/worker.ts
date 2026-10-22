import handler from '@tanstack/react-start/server-entry'

/**
 * Cloudflare Workers の入口(`wrangler.jsonc` の `main`)。
 * `/api/*` は、サービスバインディング(`API`)で api の Worker にそのまま転送する。
 * ブラウザからは web のオリジンしか見えないので、cookie は同一サイトになり、CORS も要らない。
 * それ以外は、TanStack Start の元のハンドラ(SSR)に渡す。
 */
type Env = { API: { fetch(request: Request): Promise<Response> } }

export default {
  fetch(request: Request, env: Env, ctx: unknown) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/')) return env.API.fetch(request)
    return (
      handler as { fetch: (...args: unknown[]) => Promise<Response> }
    ).fetch(request, env, ctx)
  },
}
