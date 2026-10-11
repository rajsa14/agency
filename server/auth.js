// One shared password (ADMIN_PASSWORD) and a signed, HttpOnly session cookie. Web Crypto only, so it runs on Workers and Node alike.
const encoder = new TextEncoder()
const COOKIE = 'agency_session'
const LIFETIME = 30 * 24 * 60 * 60

const base64url = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function sign(secret, text) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(text)))
}

function same(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const secret = (env) => env.SESSION_SECRET || `agency-session:${env.ADMIN_PASSWORD}`

export const required = (env) => Boolean(env.ADMIN_PASSWORD)

// Both sides are signed first so the comparison takes the same time whatever was typed.
export async function passwordMatches(env, password) {
  return same(await sign('agency-password', String(password)), await sign('agency-password', env.ADMIN_PASSWORD))
}

export async function check(env, request, now) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  if (!match) return false
  const [expires, signature] = match[1].split('.')
  if (!expires || !signature || Number(expires) * 1000 < now.getTime()) return false
  return same(signature, await sign(secret(env), expires))
}

export async function cookie(env, request, now) {
  const expires = String(Math.floor(now.getTime() / 1000) + LIFETIME)
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${COOKIE}=${expires}.${await sign(secret(env), expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${LIFETIME}${secure}`
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
