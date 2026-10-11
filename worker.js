// Cloudflare entry. Static files in public/ are served by the platform; everything under /api/ comes here.
// Needs the D1 binding DB and the secrets ADMIN_PASSWORD and ANTHROPIC_API_KEY (see README).
import { createApp } from './server/app.js'
import { d1 } from './server/db.js'

let db

export default {
  fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    db ??= d1(env.DB)
    return createApp({ db, env }).fetch(request, ctx)
  },
}
