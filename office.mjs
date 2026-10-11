#!/usr/bin/env node
// The agency office.
//   node office.mjs         open the office at http://localhost:5190 with editing switched on
//   node office.mjs build   regenerate data.js from agents/*.md (for the read-only page)
//   node office.mjs sync    install agents/*.md into ~/.claude/agents so Claude Code uses them
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = dirname(fileURLToPath(import.meta.url))
const AGENTS = join(ROOT, 'agents')
const INSTALLED = join(homedir(), '.claude', 'agents')
const PORT = 5190

const HAIR = ['spikes', 'tuft', 'parting', 'curl', 'bald']
const PROPS = ['clipboard', 'hardhat', 'pencil', 'check', 'magnifier', 'envelope', 'megaphone', 'none']

const split = (raw) => raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)

function unquote(v) {
  if (/^".*"$/.test(v)) {
    try { return JSON.parse(v) } catch { return v.slice(1, -1) }
  }
  return /^'.*'$/.test(v) ? v.slice(1, -1) : v
}

const quote = (v) => (/^[\p{L}\p{N}][\p{L}\p{N} .,()/&+-]*$/u.test(v) ? v : JSON.stringify(v))

const files = () => readdirSync(AGENTS).filter((f) => /^[a-z0-9-]+\.md$/.test(f)).sort()

function read(file) {
  const m = split(readFileSync(join(AGENTS, file), 'utf8'))
  if (!m) return null
  const meta = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = unquote(line.slice(i + 1).trim())
  }
  return {
    file,
    name: meta.name || file,
    job: meta.job || meta.name || file,
    department: meta.department || 'Unassigned',
    floor: Number(meta.floor) || 0,
    desk: Number(meta.desk) || 99,
    description: meta.description || '',
    tools: meta.tools || '',
    color: meta.color || '',
    avatar: meta.avatar === 'claude' ? 'claude' : 'helper',
    eyes: meta.avatar_eyes === '1' ? 1 : 2,
    hair: HAIR.includes(meta.avatar_hair) ? meta.avatar_hair : 'tuft',
    prop: PROPS.includes(meta.avatar_prop) ? meta.avatar_prop : 'none',
    body: m[2].trim(),
  }
}

const roster = () => files().map(read).filter(Boolean).sort((a, b) => a.desk - b.desk)

function build() {
  const agents = roster()
  writeFileSync(join(ROOT, 'data.js'), `window.AGENCY = ${JSON.stringify(agents, null, 1)}\n`)
  return agents
}

function sync(only) {
  mkdirSync(INSTALLED, { recursive: true })
  const list = only ? [only] : files()
  for (const f of list) copyFileSync(join(AGENTS, f), join(INSTALLED, f))
  return list
}

// Only the frontmatter keys below and the body can be changed from the office; everything else stays as written.
function save(file, changes) {
  const text = (key, max) => {
    const v = String(changes[key] ?? '').replace(/\s+/g, ' ').trim()
    if (!v || v.length > max) throw new Error(`${key} must be 1-${max} characters`)
    return v
  }
  const set = {}
  if ('job' in changes) set.job = text('job', 60)
  if ('department' in changes) {
    set.department = text('department', 60)
    const peer = roster().find((a) => a.file !== file && a.department.toLowerCase() === set.department.toLowerCase())
    set.department = peer ? peer.department : set.department
    set.floor = String(peer ? peer.floor : 0)
  }
  if ('description' in changes) set.description = text('description', 1000)
  if ('eyes' in changes) set.avatar_eyes = String(changes.eyes) === '1' ? '1' : '2'
  if ('hair' in changes) {
    if (!HAIR.includes(changes.hair)) throw new Error('unknown hair')
    set.avatar_hair = changes.hair
  }
  if ('prop' in changes) {
    if (!PROPS.includes(changes.prop)) throw new Error('unknown prop')
    set.avatar_prop = changes.prop
  }

  const path = join(AGENTS, file)
  const m = split(readFileSync(path, 'utf8'))
  const lines = m[1].split('\n')
  for (const [key, value] of Object.entries(set)) {
    const line = `${key}: ${quote(value)}`
    const at = lines.findIndex((l) => l.startsWith(`${key}:`))
    if (at >= 0) lines[at] = line
    else lines.push(line)
  }
  let body = m[2].trim()
  if ('body' in changes) {
    body = String(changes.body).replace(/\r\n/g, '\n').trim()
    if (!body || body.length > 100_000) throw new Error('instructions must be 1-100000 characters')
  }
  writeFileSync(path, `---\n${lines.join('\n')}\n---\n\n${body}\n`)
}

const STATIC = { '/': 'index.html', '/office.css': 'office.css', '/office.js': 'office.js', '/avatars.js': 'avatars.js', '/data.js': 'data.js' }
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }

function serve() {
  build()
  const hosts = [`localhost:${PORT}`, `127.0.0.1:${PORT}`]
  createServer((req, res) => {
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    // The server writes files, so it answers only to this machine's own page.
    if (!hosts.includes(req.headers.host)) return send(403, { error: 'forbidden' })
    const path = new URL(req.url, 'http://x').pathname

    if (req.method === 'GET' && STATIC[path]) {
      const name = STATIC[path]
      return send(200, readFileSync(join(ROOT, name), 'utf8'), TYPES[extname(name)])
    }
    if (req.method === 'GET' && path === '/api/agents') return send(200, roster())

    const target = path.match(/^\/api\/agents\/([a-z0-9-]+\.md)$/)
    if (req.method === 'PUT' && target) {
      if (req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: 'forbidden' })
      if (!files().includes(target[1])) return send(404, { error: 'no such agent' })
      let raw = ''
      req.on('data', (c) => {
        raw += c
        if (raw.length > 300_000) req.destroy()
      })
      req.on('end', () => {
        try {
          save(target[1], JSON.parse(raw))
          sync(target[1])
          send(200, build())
        } catch (e) {
          send(400, { error: e.message })
        }
      })
      return
    }
    send(404, { error: 'not found' })
  }).listen(PORT, '127.0.0.1', () => console.log(`Agency office open at http://localhost:${PORT}`))
}

const command = process.argv[2]
if (command === 'build') console.log(`data.js: ${build().length} agents`)
else if (command === 'sync') console.log(`Installed into ${INSTALLED}:\n  ${sync().join('\n  ')}`)
else serve()
