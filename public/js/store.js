// What the page knows and what it can ask the server to do. Views read S and call the actions; nothing here draws.
import { toast, AGENT_STATE, short } from './dom.js'

export const S = {
  session: null, // { authed, required, locked, local }
  data: null, // the server state: agents, tasks, deps, messages, events, ai, open
  panel: null, // { type: 'agent' | 'task' | 'new-agent', id, tab }
  sheet: null, // 'tasks' | 'approvals' | 'history' | 'settings'
  chat: false,
  live: new Map(), // task id -> text streamed so far in this browser
  planning: false,
}

const listeners = new Set()
export const onChange = (fn) => listeners.add(fn)
export const changed = () => listeners.forEach((fn) => fn())

export async function api(method, path, data) {
  const res = await fetch(path, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined })
  const out = await res.json().catch(() => ({}))
  if (res.status === 401 && S.session?.authed) {
    S.session.authed = false
    changed()
  }
  if (!res.ok) throw new Error(out.error || 'To se nepovedlo.')
  return out
}

// Every action that changes something answers with the whole fresh state.
export async function act(run, done) {
  try {
    const data = await run()
    if (data?.agents) S.data = data
    done?.()
    changed()
    pump()
    return true
  } catch (e) {
    toast(e.message)
    return false
  }
}

export async function load() {
  if (!S.session?.authed) return
  try {
    S.data = await api('GET', '/api/state')
    changed()
    pump()
  } catch {}
}

export const agentOf = (id) => S.data?.agents.find((a) => a.id === id)
export const taskOf = (id) => S.data?.tasks.find((t) => t.id === id)
export const tasksOf = (agentId) => S.data.tasks.filter((t) => t.agent_id === agentId)
export const depsOf = (taskId) => S.data.deps.filter((d) => d.task_id === taskId).map((d) => taskOf(d.depends_on)).filter(Boolean)
export const blockedBy = (task) => depsOf(task.id).filter((d) => d.status !== 'completed')
export const isRunning = (t) => t.status === 'thinking' || t.status === 'working'

// An agent's status is read off its tasks, so it can never claim work that is not happening.
export function agentState(id) {
  const mine = tasksOf(id)
  const running = mine.find(isRunning)
  if (running) return { state: running.status, text: `${running.activity || AGENT_STATE[running.status]} · ${short(running.title, 30)}`, task: running }
  const review = mine.filter((t) => t.status === 'needs_approval')
  if (review.length) return { state: 'needs_approval', text: review.length > 1 ? `Ke schválení: ${review.length}` : `Ke schválení · ${short(review[0].title, 28)}`, task: review[0] }
  const failed = mine.find((t) => t.status === 'error')
  if (failed) return { state: 'error', text: `Chyba · ${short(failed.title, 30)}`, task: failed }
  const waiting = mine.filter((t) => t.status === 'queued' || t.status === 'paused')
  if (waiting.length) return { state: 'waiting', text: waiting.length > 1 ? `Čeká: ${waiting.length} úkoly` : `Čeká · ${short(waiting[0].title, 30)}`, task: waiting[0] }
  const fresh = mine.find((t) => t.status === 'completed' && Date.now() - new Date(t.updated_at) < 20_000)
  if (fresh) return { state: 'completed', text: 'Hotovo', task: fresh }
  return { state: 'idle', text: '', task: null }
}

export const counts = () => {
  const t = S.data.tasks
  return {
    running: t.filter(isRunning).length,
    waiting: t.filter((x) => x.status === 'queued' || x.status === 'paused').length,
    review: t.filter((x) => x.status === 'needs_approval').length,
    done: t.filter((x) => x.status === 'completed').length,
    open: t.filter((x) => !['completed', 'cancelled'].includes(x.status)).length,
  }
}

// ---------- running tasks ----------
const streaming = new Set()
const retryAfter = new Map()
const RANK = { urgent: 0, high: 1, normal: 2, low: 3 }

async function runTask(id) {
  streaming.add(id)
  try {
    const res = await fetch(`/api/tasks/${id}/run`, { method: 'POST' })
    if (!res.ok) {
      // Somebody else started it, the agent got busy, or the office closed: leave it queued and look again later.
      retryAfter.set(id, Date.now() + 10_000)
      return
    }
    S.live.set(id, '')
    load()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const type = block.match(/^event: (.*)$/m)?.[1]
        const data = JSON.parse(block.match(/^data: (.*)$/m)?.[1] || '{}')
        if (type === 'delta') {
          S.live.set(id, (S.live.get(id) || '') + data.text)
          liveListeners.forEach((fn) => fn(id))
        } else if (type === 'status') {
          const t = taskOf(id)
          if (t) Object.assign(t, { status: data.status, activity: data.activity })
          changed()
        } else if (type === 'error') toast(data.message)
      }
    }
  } catch {
    // The connection dropped; the server finishes or times the run out, and the next refresh shows which.
  } finally {
    streaming.delete(id)
    S.live.delete(id)
    load()
  }
}

const liveListeners = new Set()
export const onLive = (fn) => (liveListeners.add(fn), () => liveListeners.delete(fn))

// Starts every task that is marked to run and has nothing in its way. The server has the final say on each start.
export function pump() {
  const d = S.data
  if (!d || !d.open || !d.ai.provider || !S.session?.authed) return
  const busy = new Set(d.tasks.filter(isRunning).map((t) => t.agent_id))
  const ready = d.tasks
    .filter((t) => t.kind === 'task' && t.status === 'queued' && t.auto && !streaming.has(t.id) && (retryAfter.get(t.id) || 0) < Date.now() && !blockedBy(t).length)
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.created_at.localeCompare(b.created_at))
  for (const t of ready) {
    if (streaming.size >= 3) break
    if (busy.has(t.agent_id)) continue
    busy.add(t.agent_id)
    runTask(t.id)
  }
}

// ---------- actions ----------
export const startTask = (id) => {
  retryAfter.delete(id)
  return act(() => api('PATCH', `/api/tasks/${id}`, { auto: true }))
}
export const taskAction = (id, action, body) => act(() => api('POST', `/api/tasks/${id}/${action}`, body || {}))
export const removeTask = (id) => act(() => api('DELETE', `/api/tasks/${id}`))

export function openAgent(id, tab = 'assign') {
  S.panel = { type: 'agent', id, tab }
  changed()
}
export function openTask(id) {
  S.panel = { type: 'task', id, from: S.panel?.type === 'agent' ? S.panel.id : S.panel?.from }
  changed()
}
export function closePanel() {
  S.panel = null
  changed()
}
export function openSheet(name) {
  S.sheet = S.sheet === name ? null : name
  changed()
}

// The same department order the office floor uses, so a face in a panel has the colour of the figure at the desk.
export function tintOf(agent) {
  const zones = new Map()
  for (const a of S.data.agents) {
    const z = zones.get(a.department) || { name: a.department, floor: a.floor, boss: false }
    z.floor = Math.max(z.floor, a.floor)
    z.boss ||= Boolean(a.is_manager)
    zones.set(a.department, z)
  }
  const order = [...zones.values()].sort((a, b) => b.floor - a.floor || a.name.localeCompare(b.name)).filter((z) => !z.boss)
  return Math.max(0, order.findIndex((z) => z.name === agent.department))
}
export const face = (agent) => window.avatarSVG({ ...agent.look, color: agent.color }, tintOf(agent))
export const modelName = (agent) => {
  const ai = S.data.ai
  const id = agent.model || ai.defaultModel
  return ai.models.find((m) => m.id === id)?.name || id
}
