/**
 * Cloudflare Pages Function that runs in front of every request (pages and static files)
 * and requires HTTP Basic credentials. The username and password come from the
 * APP_USER and APP_PASSWORD environment variables (Pages -> Settings -> Variables and
 * Secrets). If they are not set the site refuses to serve: it fails closed.
 */
interface Env {
  APP_USER?: string
  APP_PASSWORD?: string
}

const enc = new TextEncoder()

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

/** Constant-time comparison (hashing first makes the lengths equal). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

export async function isAuthorised(header: string | null, user: string, password: string): Promise<boolean> {
  if (!header?.startsWith('Basic ')) return false
  let decoded: string
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6).trim()), (c) => c.charCodeAt(0)))
  } catch {
    return false
  }
  const i = decoded.indexOf(':')
  if (i < 0) return false
  const okUser = await safeEqual(decoded.slice(0, i), user)
  const okPass = await safeEqual(decoded.slice(i + 1), password)
  return okUser && okPass
}

export const onRequest = async (ctx: { request: Request; env: Env; next: () => Promise<Response> }): Promise<Response> => {
  const { APP_USER, APP_PASSWORD } = ctx.env
  if (!APP_USER || !APP_PASSWORD) return new Response('Login is not configured.', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  if (await isAuthorised(ctx.request.headers.get('Authorization'), APP_USER, APP_PASSWORD)) return ctx.next()
  return new Response('Sign in required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Expense Reports", charset="UTF-8"', 'Cache-Control': 'no-store' },
  })
}
