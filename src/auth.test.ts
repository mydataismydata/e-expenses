import { describe, expect, it } from 'vitest'
import { isAuthorised, onRequest } from '../functions/_middleware'

const basic = (s: string) => `Basic ${btoa(s)}`

describe('login gate', () => {
  it('accepts only the right credentials', async () => {
    expect(await isAuthorised(basic('me:s3cret:with:colons'), 'me', 's3cret:with:colons')).toBe(true)
    expect(await isAuthorised(basic('me:wrong'), 'me', 's3cret')).toBe(false)
    expect(await isAuthorised(basic('you:s3cret'), 'me', 's3cret')).toBe(false)
    expect(await isAuthorised(null, 'me', 's3cret')).toBe(false)
    expect(await isAuthorised('Bearer abc', 'me', 's3cret')).toBe(false)
    expect(await isAuthorised('Basic !!!notbase64', 'me', 's3cret')).toBe(false)
  })

  it('challenges, serves, and fails closed', async () => {
    const next = async () => new Response('app')
    const req = (auth?: string) => new Request('https://x.test/', { headers: auth ? { Authorization: auth } : {} })
    const env = { APP_USER: 'me', APP_PASSWORD: 'pw' }
    expect((await onRequest({ request: req(), env, next })).status).toBe(401)
    expect((await onRequest({ request: req(basic('me:pw')), env, next })).status).toBe(200)
    expect((await onRequest({ request: req(basic('me:pw')), env: {}, next })).status).toBe(503)
  })
})
