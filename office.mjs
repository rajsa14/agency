#!/usr/bin/env node
// The agency office.
//   node office.mjs              open the office at http://localhost:5190 with editing switched on
//   node office.mjs build        regenerate data.js from agents/*.md (for the read-only page)
//   node office.mjs sync         install agents/*.md and the run-agency skill into ~/.claude
//   node office.mjs queue        list the tasks given in the office
//   node office.mjs next         hand out the next queued task (nothing is handed out 22:00-06:00)
//   node office.mjs done <id>    mark a task finished; its result is work/results/<id>.md
//   node office.mjs fail <id> <reason>
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = dirname(fileURLToPath(import.meta.url))
const AGENTS = join(ROOT, 'agents')
const WORK = join(ROOT, 'work')
const RESULTS = join(WORK, 'results')
const STATE = join(WORK, 'state.json')
const SKILL = join(ROOT, '.claude', 'skills', 'run-agency', 'SKILL.md')
const HOME = join(homedir(), '.claude')
const PORT = 5190

const HAIR = ['spikes', 'tuft', 'parting', 'curl', 'bald']
const PROPS = ['clipboard', 'hardhat', 'pencil', 'check', 'magnifier', 'envelope', 'megaphone', 'none']
const ACTIVITIES = ['auto', 'desk', 'coffee', 'walk', 'chat', 'dance']

// Nobody works between 22:00 and 06:00.
const OPENS = 6
const CLOSES = 22
const isOpen = (d = new Date()) => d.getHours() >= OPENS && d.getHours() < CLOSES

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
  mkdirSync(join(HOME, 'agents'), { recursive: true })
  const list = only ? [only] : files()
  for (const f of list) copyFileSync(join(AGENTS, f), join(HOME, 'agents', f))
  if (!only) {
    mkdirSync(join(HOME, 'skills', 'run-agency'), { recursive: true })
    copyFileSync(SKILL, join(HOME, 'skills', 'run-agency', 'SKILL.md'))
  }
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

// ---------- what everyone is doing: activities and the task queue ----------
function loadState() {
  try {
    const s = JSON.parse(readFileSync(STATE, 'utf8'))
    return { activities: s.activities || {}, tasks: s.tasks || [] }
  } catch {
    return { activities: {}, tasks: [] }
  }
}

function saveState(state) {
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(STATE, JSON.stringify(state, null, 1))
}

const resultPath = (id) => join(RESULTS, `${id}.md`)

function addTask(file, text) {
  const task = String(text ?? '').replace(/\r\n/g, '\n').trim()
  if (!task || task.length > 4000) throw new Error('task must be 1-4000 characters')
  if (!files().includes(file)) throw new Error('no such agent')
  const state = loadState()
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  state.tasks.push({ id, agent: file, task, status: 'queued', created: new Date().toISOString(), started: null, finished: null, error: null })
  saveState(state)
}

function changeTask(id, change) {
  const state = loadState()
  const task = state.tasks.find((t) => t.id === id)
  if (!task) throw new Error('no such task')
  change(task, state)
  saveState(state)
  return task
}

function nextTask() {
  if (!isOpen()) return { closed: true, opens: `${String(OPENS).padStart(2, '0')}:00` }
  const state = loadState()
  const busy = new Set(state.tasks.filter((t) => t.status === 'running').map((t) => t.agent))
  const task = state.tasks.find((t) => t.status === 'queued' && !busy.has(t.agent))
  if (!task) return { none: true }
  const agent = read(task.agent)
  if (!agent) {
    task.status = 'failed'
    task.error = 'agent file is gone'
    saveState(state)
    return nextTask()
  }
  task.status = 'running'
  task.started = new Date().toISOString()
  saveState(state)
  mkdirSync(join(WORK, 'files'), { recursive: true })
  return { id: task.id, agent: agent.name, task: task.task, result: resultPath(task.id), files: join(WORK, 'files') }
}

const STATIC = {
  '/': 'index.html',
  '/office.css': 'office.css',
  '/office.js': 'office.js',
  '/characters.js': 'characters.js',
  '/avatars.js': 'avatars.js',
  '/data.js': 'data.js',
}
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
    const state = () => ({ ...loadState(), open: isOpen(), hours: [OPENS, CLOSES] })

    if (req.method === 'GET') {
      if (STATIC[path]) return send(200, readFileSync(join(ROOT, STATIC[path]), 'utf8'), TYPES[extname(STATIC[path])])
      if (path === '/api/agents') return send(200, roster())
      if (path === '/api/state') return send(200, state())
      const result = path.match(/^\/api\/tasks\/([a-z0-9]+)\/result$/)
      if (result) return existsSync(resultPath(result[1])) ? send(200, readFileSync(resultPath(result[1]), 'utf8'), 'text/plain') : send(404, { error: 'no result yet' })
      return send(404, { error: 'not found' })
    }

    if (req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: 'forbidden' })
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 300_000) req.destroy()
    })
    req.on('end', () => {
      try {
        const data = raw ? JSON.parse(raw) : {}
        let m
        if (req.method === 'PUT' && (m = path.match(/^\/api\/agents\/([a-z0-9-]+\.md)$/))) {
          if (!files().includes(m[1])) return send(404, { error: 'no such agent' })
          save(m[1], data)
          sync(m[1])
          return send(200, build())
        }
        if (req.method === 'PUT' && (m = path.match(/^\/api\/activity\/([a-z0-9-]+\.md)$/))) {
          if (!files().includes(m[1]) || !ACTIVITIES.includes(data.activity)) return send(400, { error: 'unknown agent or activity' })
          const s = loadState()
          s.activities[m[1]] = data.activity
          saveState(s)
          return send(200, state())
        }
        if (req.method === 'POST' && path === '/api/tasks') {
          addTask(data.agent, data.task)
          return send(200, state())
        }
        if (req.method === 'POST' && (m = path.match(/^\/api\/tasks\/([a-z0-9]+)\/requeue$/))) {
          changeTask(m[1], (t) => Object.assign(t, { status: 'queued', started: null, finished: null, error: null }))
          return send(200, state())
        }
        if (req.method === 'DELETE' && (m = path.match(/^\/api\/tasks\/([a-z0-9]+)$/))) {
          changeTask(m[1], (t, s) => s.tasks.splice(s.tasks.indexOf(t), 1))
          rmSync(resultPath(m[1]), { force: true })
          return send(200, state())
        }
        send(404, { error: 'not found' })
      } catch (e) {
        send(400, { error: e.message })
      }
    })
  }).listen(PORT, '127.0.0.1', () => console.log(`Agency office open at http://localhost:${PORT}`))
}

const [command, id, ...rest] = process.argv.slice(2)
try {
  if (command === 'build') console.log(`data.js: ${build().length} agents`)
  else if (command === 'sync') console.log(`Installed into ${HOME}:\n  ${sync().join('\n  ')}\n  skills/run-agency`)
  else if (command === 'queue') console.log(JSON.stringify({ open: isOpen(), tasks: loadState().tasks }, null, 1))
  else if (command === 'next') console.log(JSON.stringify(nextTask(), null, 1))
  else if (command === 'done') {
    if (!existsSync(resultPath(id))) throw new Error(`write the result to ${resultPath(id)} first`)
    changeTask(id, (t) => Object.assign(t, { status: 'done', finished: new Date().toISOString(), error: null }))
    console.log(`done ${id}`)
  } else if (command === 'fail') {
    changeTask(id, (t) => Object.assign(t, { status: 'failed', finished: new Date().toISOString(), error: rest.join(' ').slice(0, 500) || 'failed' }))
    console.log(`failed ${id}`)
  } else serve()
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
