import { Elysia } from "elysia";
import { productRoutes } from "../../src/routes/product";
import { productManageRoutes } from "../../src/routes/product-manage";

export const app = new Elysia().use(productRoutes).use(productManageRoutes);

type Opts = {
  cookie?: string;
  /** JSON.stringify して送る */
  body?: unknown;
  /** 文字列のまま送る(壊れた JSON など) */
  raw?: string;
  contentType?: string;
};

export function call(method: string, path: string, opts: Opts = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined) headers.set("content-type", opts.contentType ?? "application/json");
  return app.handle(new Request(`http://localhost${path}`, { method, headers, body }));
}

export const patch = (id: string, cookie: string | undefined, body: unknown) =>
  call("PATCH", `/api/product/${id}`, { cookie, body });
export const del = (id: string, cookie?: string) => call("DELETE", `/api/product/${id}`, { cookie });
export const get = (id: string, cookie?: string) => call("GET", `/api/product/${id}`, { cookie });
export const list = (cookie?: string) => call("GET", "/api/product", { cookie });
