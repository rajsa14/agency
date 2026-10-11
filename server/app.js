// The office backend: agents, tasks, runs, approvals, the manager's plans and the activity log.
// It is a plain fetch handler, so the same code serves Cloudflare Workers (worker.js) and Node (office.mjs).
import { ready, log, newId, setting, setSetting } from './db.js'
import { isOpen, OPENS, CLOSES } from './time.js'
import * as auth from './auth.js'
import { MODELS, DEFAULT_MODEL, providers, resolveProvider, runText, runPlan, isAbort, RunError } from './ai.js'

const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const IDLE = ['auto', 'desk', 'coffee', 'walk', 'chat', 'dance']
const HAIR = ['spikes', 'tuft', 'parting', 'curl', 'bald']
const PROPS = ['clipboard', 'hardhat', 'pencil', 'check', 'magnifier', 'envelope', 'megaphone', 'none']
const ACTIVE = `('thinking','working')`
const STALE_MS = 90_000
const HEARTBEAT_MS = 1500

const WORKPLACE = `

## Where you are working
You are working inside the Agency web office. You have no files, browser or shell here{search}. Where the instructions above rely on tools or local files you do not have, work from what the task gives you and say briefly what you could not check.
Your reply is the deliverable. Write the finished result in Markdown, in the language of the task, with no preamble and no closing offer. A person reviews it and either approves it or sends it back with comments.`

const PLANNING = `

## Planning in the web office
A request has come in through the office chat. Split it into the smallest set of tasks that gets it done and assign each task to exactly one agent from the roster below, by its id. Do not assign tasks to yourself.
- Write titles and descriptions in the language of the request.
- Each description must stand on its own: the agent sees only that description plus the results of the tasks it depends on.
- Use depends_on (the keys of earlier tasks) when a task needs another task's result. A dependent task starts only after the earlier result has been approved.
- If nobody on the roster can do part of the request, leave that part out and say so in the summary.
- The summary is two or three sentences for the person who sent the request: what will happen and in what order.`

const PLAN_SCHEMA = (ids) => ({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          agent_id: { type: 'string', enum: ids },
          priority: { type: 'string', enum: PRIORITIES },
          depends_on: { type: 'array', items: { type: 'string' } },
        },
        required: ['key', 'title', 'description', 'agent_id', 'priority', 'depends_on'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'tasks'],
  additionalProperties: false,
})

class Problem extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })

function text(value, max, name, needed = false) {
  const v = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (needed && !v) throw new Problem(400, `${name}: vyplň prosím.`)
  if (v.length > max) throw new Problem(400, `${name}: nejvýše ${max} znaků.`)
  return v
}

const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback)
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const agentOut = (a) => ({ ...a, look: safeParse(a.look, {}) })
const safeParse = (s, fallback) => {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

function look(input = {}) {
  return {
    avatar: input.avatar === 'claude' ? 'claude' : 'helper',
    eyes: String(input.eyes) === '1' ? 1 : 2,
    hair: oneOf(input.hair, HAIR, 'tuft'),
    prop: oneOf(input.prop, PROPS, 'none'),
  }
}

// ---------- shared between the web API and the command line (office.mjs next / done / fail) ----------

export async function sweep(db, now) {
  const cutoff = new Date(now.getTime() - STALE_MS).toISOString()
  const stale = await db.all(`SELECT t.id, t.agent_id, t.run_id, t.title FROM tasks t JOIN runs r ON r.id = t.run_id WHERE t.status IN ${ACTIVE} AND r.provider != 'claude-code' AND r.heartbeat_at < ?`, cutoff)
  for (const t of stale) {
    const at = now.toISOString()
    const message = 'Běh se přerušil, protože se ztratilo spojení se serverem. Zkus úkol spustit znovu.'
    const res = await db.run(`UPDATE tasks SET status = 'error', error = ?, activity = '', finished_at = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status IN ${ACTIVE}`, message, at, at, t.id, t.run_id)
    if (!res.changes) continue
    await db.run(`UPDATE runs SET status = 'error', error = ?, finished_at = ? WHERE id = ?`, message, at, t.run_id)
    await log(db, 'run_failed', 'system', `Běh úkolu „${t.title}“ se přerušil.`, { agent: t.agent_id, task: t.id })
  }
}

async function blockers(db, taskId) {
  const deps = await db.all('SELECT t.id, t.title, t.status FROM task_deps d JOIN tasks t ON t.id = d.depends_on WHERE d.task_id = ?', taskId)
  return deps.filter((d) => d.status !== 'completed')
}

// The single place a task goes from waiting to running. The WHERE clause makes it safe against double starts:
// only a queued task can be claimed, and never while the same agent is already running another one.
async function claim(db, task, provider, model, now) {
  const runId = newId('r')
  const at = now.toISOString()
  const res = await db.run(
    `UPDATE tasks SET status = 'thinking', run_id = ?, activity = 'Přemýšlí', error = '', started_at = ?, finished_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'queued'
       AND NOT EXISTS (SELECT 1 FROM tasks other WHERE other.agent_id = tasks.agent_id AND other.status IN ${ACTIVE})`,
    runId, at, at, task.id,
  )
  if (!res.changes) return null
  await db.run(`INSERT INTO runs (id, task_id, agent_id, revision, status, provider, model, started_at, heartbeat_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`, runId, task.id, task.agent_id, task.revision, provider, model, at, at)
  return runId
}

async function succeed(db, task, runId, result, usage = {}) {
  const at = new Date().toISOString()
  const res = await db.run(`UPDATE tasks SET status = 'needs_approval', result = ?, activity = '', finished_at = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status IN ${ACTIVE}`, result, at, at, task.id, runId)
  await db.run(`UPDATE runs SET status = ?, output = ?, input_tokens = ?, output_tokens = ?, model = COALESCE(?, model), finished_at = ?, heartbeat_at = ? WHERE id = ?`, res.changes ? 'done' : 'cancelled', result, usage.inputTokens || 0, usage.outputTokens || 0, usage.model || null, at, at, runId)
  if (res.changes) await log(db, 'run_done', 'agent', `Úkol „${task.title}“ je hotový a čeká na schválení.`, { agent: task.agent_id, task: task.id })
  return Boolean(res.changes)
}

async function fail(db, task, runId, message) {
  const at = new Date().toISOString()
  const res = await db.run(`UPDATE tasks SET status = 'error', error = ?, activity = '', finished_at = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status IN ${ACTIVE}`, message, at, at, task.id, runId)
  await db.run(`UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?`, res.changes ? 'error' : 'cancelled', message, at, runId)
  if (res.changes) await log(db, 'run_failed', 'agent', `Úkol „${task.title}“ skončil chybou: ${message}`, { agent: task.agent_id, task: task.id })
}

const ORDER = `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at`

// For Claude Code as the worker (the run-agency skill): hand out the next task that is ready.
export async function claimNext(db, now = new Date()) {
  await ready(db)
  await sweep(db, now)
  if (!isOpen(now)) return { closed: true, opens: `${String(OPENS).padStart(2, '0')}:00` }
  const queued = await db.all(`SELECT * FROM tasks WHERE status = 'queued' AND kind = 'task' ORDER BY ${ORDER}`)
  for (const task of queued) {
    if ((await blockers(db, task.id)).length) continue
    const agent = await db.get('SELECT * FROM agents WHERE id = ? AND archived = 0', task.agent_id)
    if (!agent) continue
    const user = await brief(db, task)
    const runId = await claim(db, task, 'claude-code', 'claude-code', now)
    if (!runId) continue
    await db.run(`UPDATE tasks SET status = 'working', activity = 'Pracuje v Claude Code' WHERE id = ?`, task.id)
    await log(db, 'run_started', 'system', `${agent.role} začal pracovat na úkolu „${task.title}“ (Claude Code).`, { agent: agent.id, task: task.id })
    return { id: task.id, agent: agent.name, task: user }
  }
  return { none: true }
}

export async function finishExternal(db, id, result, error) {
  await ready(db)
  const task = await db.get(`SELECT * FROM tasks WHERE id = ? AND status IN ${ACTIVE}`, id)
  if (!task) throw new Error('Tento úkol právě neběží.')
  if (error) await fail(db, task, task.run_id, error)
  else await succeed(db, task, task.run_id, result, { model: 'claude-code' })
}

export async function heartbeat(db, id) {
  await db.run(`UPDATE runs SET heartbeat_at = ? WHERE id = (SELECT run_id FROM tasks WHERE id = ? AND status IN ${ACTIVE})`, new Date().toISOString(), id)
}

// What the agent is handed: the task, its context and attachments, the approved results it builds on,
// and on a rework the previous version with the reviewer's comments.
async function brief(db, task) {
  const parts = [`# Úkol: ${task.title}`, task.description]
  if (task.context) parts.push(`## Kontext a požadavky\n${task.context}`)
  parts.push(`Priorita: ${task.priority}${task.due_at ? ` · termín: ${task.due_at}` : ''}`)
  const files = await db.all('SELECT name, content FROM attachments WHERE task_id = ? ORDER BY created_at', task.id)
  for (const f of files) parts.push(`## Příloha: ${f.name}\n<attachment name="${f.name.replace(/"/g, "'")}">\n${f.content}\n</attachment>`)
  const inputs = await db.all(`SELECT t.title, t.result, a.role FROM task_deps d JOIN tasks t ON t.id = d.depends_on JOIN agents a ON a.id = t.agent_id WHERE d.task_id = ? AND t.status = 'completed'`, task.id)
  for (const i of inputs) parts.push(`## Schválený výsledek úkolu „${i.title}“ (${i.role}), na který navazuješ\n${i.result}`)
  if (task.revision > 1 && task.result) parts.push(`## Tvoje předchozí verze\n${task.result}`)
  if (task.revision > 1 && task.feedback) parts.push(`## Připomínky k přepracování\n${task.feedback}\n\nPřepracuj výsledek podle připomínek a vrať celou novou verzi.`)
  return parts.join('\n\n')
}

// ---------- the web API ----------

export function createApp({ db, env, now = () => new Date(), hooks = {} }) {
  const local = env.LOCAL === '1'

  async function ai() {
    const dev = (await setting(db, 'dev_mode', '0')) === '1'
    return { provider: resolveProvider(env, dev), dev, providers: providers(env), models: MODELS, defaultModel: await setting(db, 'default_model', DEFAULT_MODEL) }
  }

  async function state() {
    await sweep(db, now())
    const [agents, tasks, deps, messages, events, aiState] = await Promise.all([
      db.all('SELECT * FROM agents WHERE archived = 0 ORDER BY floor DESC, sort, created_at'),
      db.all(`SELECT id, kind, title, description, agent_id, priority, status, due_at, plan_id, auto, revision, error, activity, created_at, updated_at, started_at, finished_at,
                length(result) AS result_size, substr(result, 1, 280) AS preview FROM tasks ORDER BY created_at`),
      db.all('SELECT task_id, depends_on FROM task_deps'),
      db.all('SELECT * FROM (SELECT rowid AS n, * FROM messages ORDER BY at DESC, rowid DESC LIMIT 80) ORDER BY at, n'),
      db.all('SELECT * FROM events ORDER BY id DESC LIMIT 150'),
      ai(),
    ])
    return {
      now: now().toISOString(),
      open: isOpen(now()),
      hours: [OPENS, CLOSES],
      local,
      agents: agents.map(agentOut),
      tasks,
      deps,
      messages: messages.map((m) => ({ ...m, plan: m.plan ? safeParse(m.plan, null) : null })),
      events,
      ai: aiState,
    }
  }

  const getTask = async (id) => (await db.get('SELECT * FROM tasks WHERE id = ?', id)) || fail404('Úkol neexistuje.')
  const getAgent = async (id) => (await db.get('SELECT * FROM agents WHERE id = ? AND archived = 0', id)) || fail404('Agent neexistuje.')
  const fail404 = (message) => {
    throw new Problem(404, message)
  }

  async function setDeps(taskId, ids) {
    const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => id !== taskId)
    const all = await db.all('SELECT task_id, depends_on FROM task_deps WHERE task_id != ?', taskId)
    for (const dep of wanted) {
      if (!(await db.get('SELECT 1 AS ok FROM tasks WHERE id = ?', dep))) throw new Problem(400, 'Závislost odkazuje na úkol, který neexistuje.')
      // Walk from the dependency towards what it depends on; reaching this task again would be a loop.
      const stack = [dep]
      const seen = new Set()
      while (stack.length) {
        const cur = stack.pop()
        if (cur === taskId) throw new Problem(400, 'Úkoly by na sobě závisely v kruhu.')
        if (seen.has(cur)) continue
        seen.add(cur)
        for (const d of all) if (d.task_id === cur) stack.push(d.depends_on)
      }
    }
    await db.run('DELETE FROM task_deps WHERE task_id = ?', taskId)
    for (const dep of wanted) await db.run('INSERT INTO task_deps (task_id, depends_on) VALUES (?, ?)', taskId, dep)
  }

  function due(value) {
    if (!value) return null
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) throw new Problem(400, 'Termín není platné datum.')
    return d.toISOString()
  }

  async function createTask(data, { actor = 'user', planId = null } = {}) {
    const description = text(data.description, 20000, 'Zadání', true)
    const title = text(data.title, 160, 'Název') || short(description.split('\n')[0], 80)
    const agent = await getAgent(String(data.agent_id || ''))
    const files = Array.isArray(data.attachments) ? data.attachments : []
    if (files.length > 5) throw new Problem(400, 'Nejvýše 5 příloh na úkol.')
    const id = newId('t')
    const at = now().toISOString()
    await db.run(
      `INSERT INTO tasks (id, title, description, context, agent_id, priority, due_at, plan_id, auto, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, title, description, text(data.context, 40000, 'Kontext'), agent.id, oneOf(data.priority, PRIORITIES, 'normal'), due(data.due_at), planId, data.start ? 1 : 0, at, at,
    )
    for (const f of files) {
      const content = String(f.content ?? '')
      if (content.length > 200_000) throw new Problem(400, `Příloha ${f.name}: nejvýše 200 000 znaků textu.`)
      await db.run('INSERT INTO attachments (id, task_id, name, size, content, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId('f'), id, text(f.name, 120, 'Název přílohy', true), content.length, content, at)
    }
    if (data.depends_on) await setDeps(id, data.depends_on)
    await log(db, 'task_created', actor, `Nový úkol „${title}“ pro ${agent.role}.`, { agent: agent.id, task: id })
    return id
  }

  async function move(task, from, set, values, event, message) {
    const at = now().toISOString()
    const res = await db.run(`UPDATE tasks SET ${set}, updated_at = ? WHERE id = ? AND status IN (${from.map((s) => `'${s}'`).join(',')})`, ...values, at, task.id)
    if (!res.changes) throw new Problem(409, 'Úkol je mezitím v jiném stavu. Obnov stránku.')
    await log(db, event, 'user', message, { agent: task.agent_id, task: task.id })
  }

  // Turns an approved plan into real tasks with their dependencies.
  async function applyPlan(planTask) {
    const message = await db.get('SELECT * FROM messages WHERE task_id = ?', planTask.id)
    const plan = message && safeParse(message.plan, null)
    if (!plan) throw new Problem(409, 'K tomuto plánu chybí data.')
    const ids = {}
    for (const t of plan.tasks) ids[t.key] = await createTask({ ...t, depends_on: [], start: true }, { actor: 'agent', planId: message.id })
    for (const t of plan.tasks) await setDeps(ids[t.key], t.depends_on.map((k) => ids[k]).filter(Boolean))
    for (const t of plan.tasks) t.task_id = ids[t.key]
    await db.run(`UPDATE messages SET plan = ?, plan_status = 'approved' WHERE id = ?`, JSON.stringify(plan), message.id)
  }

  function cleanPlan(raw, agents) {
    const known = new Set(agents.map((a) => a.id))
    const tasks = []
    const keys = new Set()
    for (const t of Array.isArray(raw?.tasks) ? raw.tasks : []) {
      if (!known.has(t.agent_id) || !t.key || keys.has(t.key) || !String(t.title || '').trim() || !String(t.description || '').trim()) continue
      tasks.push({
        key: String(t.key),
        title: short(String(t.title).trim(), 160),
        description: String(t.description).trim().slice(0, 20000),
        agent_id: t.agent_id,
        priority: oneOf(t.priority, PRIORITIES, 'normal'),
        // Only earlier tasks may be depended on, which also rules out loops.
        depends_on: (Array.isArray(t.depends_on) ? t.depends_on : []).filter((k) => keys.has(k)),
      })
      keys.add(String(t.key))
    }
    if (!tasks.length) throw new RunError('Manažer nenavrhl žádný úkol, který by šel někomu z týmu zadat.')
    return { summary: String(raw.summary || '').trim(), tasks }
  }

  async function chat(content) {
    const at = now().toISOString()
    await db.run(`INSERT INTO messages (id, at, role, content) VALUES (?, ?, 'user', ?)`, newId('m'), at, content)
    const say = (role, body, extra = {}) =>
      db.run('INSERT INTO messages (id, at, role, content, plan, plan_status, task_id) VALUES (?, ?, ?, ?, ?, ?, ?)', newId('m'), now().toISOString(), role, body, extra.plan || null, extra.status || null, extra.task || null)

    const manager = await db.get('SELECT * FROM agents WHERE is_manager = 1 AND archived = 0 ORDER BY created_at LIMIT 1')
    if (!manager) return say('system', 'V kanceláři není žádný manažer. V nastavení označ jednoho agenta jako manažera, aby mohl požadavky rozdělovat.')
    const { provider, defaultModel } = await ai()
    if (!provider) return say('system', 'Není nastaven žádný AI poskytovatel, takže požadavek zatím nikdo nezpracuje. Nastav na serveru ANTHROPIC_API_KEY, nebo v Nastavení zapni vývojový režim.')
    if (!isOpen(now())) return say('system', `Kancelář je zavřená do ${String(OPENS).padStart(2, '0')}:00. Pošli požadavek znovu, až bude otevřeno.`)

    const staff = (await db.all('SELECT * FROM agents WHERE archived = 0 AND is_manager = 0 ORDER BY floor DESC, sort')).map(agentOut)
    if (!staff.length) return say('system', 'Manažer nemá komu úkoly zadat. Přidej do kanceláře další agenty.')

    const taskId = newId('t')
    await db.run(`INSERT INTO tasks (id, kind, title, description, agent_id, priority, status, created_at, updated_at) VALUES (?, 'plan', ?, ?, ?, 'normal', 'queued', ?, ?)`, taskId, `Plán: ${short(content.split('\n')[0], 70)}`, content, manager.id, at, at)
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', taskId)
    const model = manager.model || defaultModel
    const runId = await claim(db, task, provider, model, now())
    if (!runId) {
      await db.run('DELETE FROM tasks WHERE id = ?', taskId)
      return say('system', `${manager.role} právě zpracovává jiný požadavek. Zkus to za chvíli.`)
    }
    await log(db, 'run_started', 'system', `${manager.role} rozděluje požadavek z chatu.`, { agent: manager.id, task: taskId })
    const beat = setInterval(() => heartbeat(db, taskId).catch(() => {}), HEARTBEAT_MS)
    try {
      const roster = staff.map((a) => `- id: ${a.id} | ${a.role} (${a.department}) | ${a.description}`).join('\n')
      const out = await runPlan({ env, provider, model, system: manager.instructions + PLANNING, user: `## Roster\n${roster}\n\n## Request\n${content}`, schema: PLAN_SCHEMA(staff.map((a) => a.id)), request: content, agents: staff })
      const plan = cleanPlan(out.plan, staff)
      const names = Object.fromEntries(staff.map((a) => [a.id, a.role]))
      const result = [plan.summary, '', ...plan.tasks.map((t, i) => `${i + 1}. **${t.title}** → ${names[t.agent_id]}${t.depends_on.length ? ` (po: ${t.depends_on.join(', ')})` : ''}`)].join('\n')
      clearInterval(beat)
      if (await succeed(db, task, runId, result, out)) await say('manager', plan.summary, { plan: JSON.stringify(plan), status: 'proposed', task: taskId })
    } catch (error) {
      clearInterval(beat)
      const message = error instanceof RunError ? error.message : 'Plán se nepodařilo sestavit.'
      if (!(error instanceof RunError)) console.error('[plan]', error)
      await fail(db, task, runId, message)
      await say('system', `Manažerovi se plán nepodařilo sestavit: ${message}`)
    }
  }

  // Runs a claimed task and reports progress through `emit`. The heartbeat doubles as the stop switch:
  // when someone pauses or cancels the task, the next beat no longer matches and the model call is aborted.
  async function execute(task, agent, provider, model, runId, emit) {
    const abort = new AbortController()
    let output = ''
    let status = 'thinking'
    let activity = 'Přemýšlí'
    let stopped = false
    let writing = Promise.resolve()
    const beat = setInterval(() => {
      writing = writing.then(async () => {
        const at = new Date().toISOString()
        await db.run('UPDATE runs SET output = ?, heartbeat_at = ? WHERE id = ?', output, at, runId)
        const res = await db.run(`UPDATE tasks SET status = ?, activity = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status IN ${ACTIVE}`, status, activity, at, task.id, runId)
        if (!res.changes) {
          stopped = true
          abort.abort()
        }
      }).catch((e) => console.error('[heartbeat]', e))
    }, HEARTBEAT_MS)
    try {
      const system = agent.instructions + WORKPLACE.replace('{search}', agent.web_search && provider !== 'dev' ? ', only web search' : '')
      const user = await brief(db, task)
      const out = await runText({
        env, provider, model, system, user, webSearch: Boolean(agent.web_search), signal: abort.signal,
        onEvent: (e) => {
          if (e.type === 'delta') output += e.text
          else [status, activity] = [e.status, e.activity]
          emit(e.type, e)
        },
      })
      clearInterval(beat)
      await writing
      const result = out.truncated ? `${out.text}\n\n> Výstup je zkrácený: model narazil na limit délky odpovědi.` : out.text
      const kept = !stopped && (await succeed(db, task, runId, result, out))
      if (!kept) await db.run(`UPDATE runs SET status = 'cancelled', output = ?, finished_at = ? WHERE id = ? AND status = 'running'`, output, new Date().toISOString(), runId)
      emit('done', { status: kept ? 'needs_approval' : 'stopped' })
    } catch (error) {
      clearInterval(beat)
      await writing
      if (stopped || isAbort(error)) {
        await db.run(`UPDATE runs SET status = 'cancelled', output = ?, finished_at = ? WHERE id = ?`, output, new Date().toISOString(), runId)
        emit('done', { status: 'stopped' })
      } else {
        const message = error instanceof RunError ? error.message : 'Úkol se nepodařilo zpracovat.'
        if (!(error instanceof RunError)) console.error('[run]', error)
        await fail(db, task, runId, message)
        emit('error', { message })
      }
    }
  }

  async function run(task, ctx) {
    if (task.kind !== 'task') throw new Problem(409, 'Plán spouští manažer z chatu.')
    if (task.status !== 'queued') throw new Problem(409, 'Spustit jde jen úkol, který čeká ve frontě.')
    if (!isOpen(now())) throw new Problem(409, `Kancelář je zavřená. Úkol se spustí po ${String(OPENS).padStart(2, '0')}:00.`)
    const waiting = await blockers(db, task.id)
    if (waiting.length) throw new Problem(409, `Úkol čeká na schválení: ${waiting.map((w) => `„${w.title}“`).join(', ')}.`)
    const agent = await getAgent(task.agent_id)
    const { provider, defaultModel } = await ai()
    if (!provider) throw new Problem(409, 'Není nastaven žádný AI poskytovatel. Nastav na serveru ANTHROPIC_API_KEY, nebo v Nastavení zapni vývojový režim.')
    const model = provider === 'dev' ? 'dev' : agent.model || defaultModel
    const runId = await claim(db, task, provider, model, now())
    if (!runId) throw new Problem(409, `${agent.role} právě pracuje na jiném úkolu. Tento počká ve frontě.`)
    await log(db, 'run_started', 'system', `${agent.role} začal pracovat na úkolu „${task.title}“.`, { agent: agent.id, task: task.id })

    const encoder = new TextEncoder()
    let controller
    let listening = true
    const body = new ReadableStream({
      start: (c) => (controller = c),
      cancel: () => (listening = false),
    })
    const emit = (event, data) => {
      if (!listening) return
      try {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      } catch {
        listening = false
      }
    }
    emit('start', { run: runId, provider, model })
    // The run does not depend on the browser staying connected; the stream is only how progress is shown.
    const work = execute(task, agent, provider, model, runId, emit).finally(() => {
      try {
        controller.close()
      } catch {}
    })
    ctx?.waitUntil?.(work)
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
  }

  async function saveAgent(id, data) {
    const existing = id ? await getAgent(id) : null
    const has = (k) => k in data
    const next = {
      name: has('name') || !existing ? text(data.name, 80, 'Jméno', true) : existing.name,
      role: has('role') || !existing ? text(data.role, 60, 'Role', true) : existing.role,
      department: has('department') || !existing ? text(data.department, 60, 'Oddělení', true) : existing.department,
      description: has('description') ? text(data.description, 1000, 'Odpovědnost') : existing?.description || '',
      instructions: has('instructions') || !existing ? text(data.instructions, 100_000, 'Instrukce', true) : existing.instructions,
      model: has('model') ? (MODELS.some((m) => m.id === data.model) ? data.model : '') : existing?.model || '',
      web_search: has('web_search') ? (data.web_search ? 1 : 0) : existing?.web_search || 0,
      is_manager: has('is_manager') ? (data.is_manager ? 1 : 0) : existing?.is_manager || 0,
      color: has('color') && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : existing?.color || '#4f6bff',
      look: JSON.stringify(has('look') ? look(data.look) : safeParse(existing?.look, look())),
      idle: has('idle') ? oneOf(data.idle, IDLE, 'auto') : existing?.idle || 'auto',
    }
    const at = now().toISOString()
    // Changing only what an agent does in its free time is not worth a log line or a file rewrite.
    const quiet = Boolean(existing) && Object.keys(data).every((k) => k === 'idle')
    // People who share a department sit together, so a new member takes the department's place in the office.
    const peer = await db.get('SELECT floor FROM agents WHERE department = ? COLLATE NOCASE AND archived = 0 AND id != ? LIMIT 1', next.department, id || '')
    const floor = peer ? peer.floor : existing && existing.department === next.department ? existing.floor : 0
    if (existing) {
      await db.run(
        `UPDATE agents SET name = ?, role = ?, department = ?, description = ?, instructions = ?, model = ?, web_search = ?, is_manager = ?, color = ?, look = ?, idle = ?, floor = ?, updated_at = ? WHERE id = ?`,
        next.name, next.role, next.department, next.description, next.instructions, next.model, next.web_search, next.is_manager, next.color, next.look, next.idle, floor, at, id,
      )
      if (!quiet) await log(db, 'agent_updated', 'user', `Upraveno nastavení agenta ${next.role}.`, { agent: id })
    } else {
      id = `${next.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent'}-${newId('a').slice(2, 8)}`
      const last = await db.get('SELECT MAX(sort) AS s FROM agents WHERE department = ? COLLATE NOCASE', next.department)
      await db.run(
        `INSERT INTO agents (id, name, role, department, description, instructions, model, web_search, is_manager, color, look, idle, floor, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, next.name, next.role, next.department, next.description, next.instructions, next.model, next.web_search, next.is_manager, next.color, next.look, next.idle, floor, (last?.s || 0) + 1, at, at,
      )
      await log(db, 'agent_created', 'user', `Do kanceláře nastoupil nový agent: ${next.role}.`, { agent: id })
    }
    if (next.is_manager) await db.run('UPDATE agents SET is_manager = 0 WHERE id != ?', id)
    if (!quiet) await hooks.agentSaved?.(agentOut(await db.get('SELECT * FROM agents WHERE id = ?', id)))
    return id
  }

  async function route(request, ctx) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const required = auth.required(env)
    const locked = !local && !required
    const authed = required ? await auth.check(env, request, now()) : local

    if (method !== 'GET' && request.headers.get('Origin') !== url.origin) throw new Problem(403, 'Požadavek z cizí stránky.')
    if (Number(request.headers.get('Content-Length') || 0) > 2_500_000) throw new Problem(413, 'Požadavek je příliš velký.')
    const body = async () => {
      try {
        return (await request.json()) || {}
      } catch {
        throw new Problem(400, 'Neplatná data.')
      }
    }

    if (method === 'GET' && path === '/api/session') return json({ authed, required, locked, local, open: isOpen(now()), hours: [OPENS, CLOSES] })
    if (method === 'GET' && path === '/api/office') {
      const agents = await db.all('SELECT id, name, role, department, description, color, look, floor, sort, is_manager, idle FROM agents WHERE archived = 0 ORDER BY floor DESC, sort, created_at')
      return json({ agents: agents.map(agentOut), open: isOpen(now()) })
    }
    if (method === 'POST' && path === '/api/login') {
      if (!required) throw new Problem(locked ? 503 : 400, locked ? 'Na serveru není nastavené heslo (ADMIN_PASSWORD).' : 'Přihlášení tu není potřeba.')
      const fails = safeParse(await setting(db, 'login_fails', '{}'), {})
      const fresh = fails.since && now().getTime() - fails.since < 10 * 60_000
      if (fresh && fails.count >= 8) throw new Problem(429, 'Příliš mnoho pokusů. Zkus to za deset minut.')
      if (!(await auth.passwordMatches(env, (await body()).password ?? ''))) {
        await setSetting(db, 'login_fails', JSON.stringify({ count: fresh ? fails.count + 1 : 1, since: fresh ? fails.since : now().getTime() }))
        throw new Problem(401, 'Špatné heslo.')
      }
      await setSetting(db, 'login_fails', '{}')
      return json({ ok: true }, 200, { 'Set-Cookie': await auth.cookie(env, request, now()) })
    }
    if (method === 'POST' && path === '/api/logout') return json({ ok: true }, 200, { 'Set-Cookie': auth.clearCookie() })

    if (!authed) throw new Problem(locked ? 503 : 401, locked ? 'Na serveru není nastavené heslo (ADMIN_PASSWORD), kancelář je jen k nahlédnutí.' : 'Přihlas se.')

    let m
    if (method === 'GET' && path === '/api/state') return json(await state())

    if (method === 'GET' && (m = path.match(/^\/api\/tasks\/(\w+)$/))) {
      const task = await getTask(m[1])
      const [runs, files, events, deps, message] = await Promise.all([
        db.all('SELECT id, revision, status, provider, model, error, input_tokens, output_tokens, started_at, finished_at FROM runs WHERE task_id = ? ORDER BY started_at DESC', task.id),
        db.all('SELECT id, name, size FROM attachments WHERE task_id = ? ORDER BY created_at', task.id),
        db.all('SELECT * FROM events WHERE task_id = ? ORDER BY id DESC LIMIT 100', task.id),
        db.all('SELECT t.id, t.title, t.status FROM task_deps d JOIN tasks t ON t.id = d.depends_on WHERE d.task_id = ?', task.id),
        db.get('SELECT plan, plan_status FROM messages WHERE task_id = ?', task.id),
      ])
      // While a task runs, its text so far lives on the run row.
      const live = ['thinking', 'working'].includes(task.status) ? (await db.get('SELECT output FROM runs WHERE id = ?', task.run_id))?.output || '' : null
      return json({ task: { ...task, result: live ?? task.result }, runs, attachments: files, events, deps, plan: message?.plan ? safeParse(message.plan, null) : null, plan_status: message?.plan_status || null })
    }

    if (method === 'GET' && path === '/api/events') {
      const agent = url.searchParams.get('agent')
      const events = agent ? await db.all('SELECT * FROM events WHERE agent_id = ? ORDER BY id DESC LIMIT 300', agent) : await db.all('SELECT * FROM events ORDER BY id DESC LIMIT 300')
      return json({ events })
    }

    if (method === 'POST' && path === '/api/tasks') {
      await createTask(await body())
      return json(await state())
    }

    if (method === 'PATCH' && (m = path.match(/^\/api\/tasks\/(\w+)$/))) {
      const task = await getTask(m[1])
      const data = await body()
      if (['thinking', 'working'].includes(task.status)) throw new Problem(409, 'Běžící úkol nejde upravit. Nejdřív ho pozastav.')
      const content = ['title', 'description', 'context', 'agent_id', 'priority', 'due_at', 'depends_on'].some((k) => k in data)
      if (content && task.kind !== 'task') throw new Problem(409, 'Plán upravit nejde.')
      if (content && ['completed', 'needs_approval'].includes(task.status)) throw new Problem(409, 'Hotový úkol už upravit nejde. Vrať ho k přepracování, nebo zadej nový.')
      const next = {
        title: 'title' in data ? text(data.title, 160, 'Název', true) : task.title,
        description: 'description' in data ? text(data.description, 20000, 'Zadání', true) : task.description,
        context: 'context' in data ? text(data.context, 40000, 'Kontext') : task.context,
        agent_id: 'agent_id' in data ? (await getAgent(String(data.agent_id))).id : task.agent_id,
        priority: 'priority' in data ? oneOf(data.priority, PRIORITIES, task.priority) : task.priority,
        due_at: 'due_at' in data ? due(data.due_at) : task.due_at,
        auto: 'auto' in data ? (data.auto ? 1 : 0) : task.auto,
      }
      if ('depends_on' in data) await setDeps(task.id, data.depends_on)
      await db.run('UPDATE tasks SET title = ?, description = ?, context = ?, agent_id = ?, priority = ?, due_at = ?, auto = ?, updated_at = ? WHERE id = ?', next.title, next.description, next.context, next.agent_id, next.priority, next.due_at, next.auto, now().toISOString(), task.id)
      if (content) await log(db, 'task_updated', 'user', `Upraveno zadání úkolu „${next.title}“.`, { agent: next.agent_id, task: task.id })
      return json(await state())
    }

    if (method === 'DELETE' && (m = path.match(/^\/api\/tasks\/(\w+)$/))) {
      const task = await getTask(m[1])
      if (['thinking', 'working'].includes(task.status)) throw new Problem(409, 'Běžící úkol nejde smazat. Nejdřív ho zruš.')
      for (const table of ['task_deps', 'attachments', 'runs']) await db.run(`DELETE FROM ${table} WHERE task_id = ?`, task.id)
      await db.run('DELETE FROM task_deps WHERE depends_on = ?', task.id)
      await db.run('DELETE FROM tasks WHERE id = ?', task.id)
      await log(db, 'task_deleted', 'user', `Smazán úkol „${task.title}“.`, { agent: task.agent_id })
      return json(await state())
    }

    if (method === 'POST' && (m = path.match(/^\/api\/tasks\/(\w+)\/(run|pause|resume|cancel|retry|approve|reject)$/))) {
      const task = await getTask(m[1])
      const action = m[2]
      if (action === 'run') return run(task, ctx)
      const t = `„${task.title}“`
      if (action === 'pause') await move(task, ['queued', 'thinking', 'working'], `status = 'paused', activity = ''`, [], 'task_paused', `Úkol ${t} je pozastavený.`)
      if (action === 'resume') await move(task, ['paused'], `status = 'queued'`, [], 'task_resumed', `Úkol ${t} se vrátil do fronty.`)
      if (action === 'cancel') {
        await move(task, ['queued', 'paused', 'thinking', 'working', 'needs_approval', 'error'], `status = 'cancelled', activity = '', finished_at = ?`, [now().toISOString()], 'task_cancelled', `Úkol ${t} je zrušený.`)
        if (task.kind === 'plan') await db.run(`UPDATE messages SET plan_status = 'rejected' WHERE task_id = ?`, task.id)
      }
      if (action === 'retry') {
        if (task.kind !== 'task') throw new Problem(409, 'Plán znovu spustíš novou zprávou v chatu.')
        await move(task, ['error', 'cancelled'], `status = 'queued', auto = 1, error = ''`, [], 'task_retried', `Úkol ${t} se zkusí znovu.`)
      }
      if (action === 'approve') {
        if (task.status !== 'needs_approval') throw new Problem(409, 'Schválit jde jen výsledek, který čeká na schválení.')
        if (task.kind === 'plan') await applyPlan(task)
        await move(task, ['needs_approval'], `status = 'completed'`, [], 'task_approved', task.kind === 'plan' ? `Plán ${t} je schválený, úkoly jsou rozdané.` : `Výsledek úkolu ${t} je schválený.`)
      }
      if (action === 'reject') {
        const feedback = text((await body()).feedback, 8000, 'Připomínky', task.kind === 'task')
        if (task.kind === 'plan') {
          await move(task, ['needs_approval'], `status = 'cancelled', finished_at = ?`, [now().toISOString()], 'task_rejected', `Plán ${t} byl zamítnut.`)
          await db.run(`UPDATE messages SET plan_status = 'rejected' WHERE task_id = ?`, task.id)
        } else {
          await move(task, ['needs_approval'], `status = 'queued', auto = 1, revision = revision + 1, feedback = ?`, [feedback], 'task_rejected', `Úkol ${t} se vrací k přepracování: ${short(feedback, 200)}`)
        }
      }
      return json(await state())
    }

    if (method === 'POST' && path === '/api/chat') {
      await chat(text((await body()).content, 8000, 'Zpráva', true))
      return json(await state())
    }

    if (method === 'POST' && path === '/api/agents') {
      await saveAgent(null, await body())
      return json(await state())
    }
    if (method === 'PATCH' && (m = path.match(/^\/api\/agents\/([\w-]+)$/))) {
      await saveAgent(m[1], await body())
      return json(await state())
    }
    if (method === 'DELETE' && (m = path.match(/^\/api\/agents\/([\w-]+)$/))) {
      const agent = await getAgent(m[1])
      if (await db.get(`SELECT 1 AS busy FROM tasks WHERE agent_id = ? AND status IN ${ACTIVE}`, agent.id)) throw new Problem(409, 'Agent právě pracuje. Nejdřív jeho úkol zruš.')
      await db.run('UPDATE agents SET archived = 1, updated_at = ? WHERE id = ?', now().toISOString(), agent.id)
      await db.run(`UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE agent_id = ? AND status IN ('queued','paused')`, now().toISOString(), agent.id)
      await log(db, 'agent_removed', 'user', `${agent.role} odešel z kanceláře.`, { agent: agent.id })
      return json(await state())
    }

    if (method === 'PUT' && path === '/api/settings') {
      const data = await body()
      if ('default_model' in data && MODELS.some((x) => x.id === data.default_model)) await setSetting(db, 'default_model', data.default_model)
      if ('dev_mode' in data) await setSetting(db, 'dev_mode', data.dev_mode ? '1' : '0')
      await log(db, 'settings', 'user', 'Změněno nastavení AI.')
      return json(await state())
    }

    throw new Problem(404, 'Tady nic není.')
  }

  return {
    async fetch(request, ctx) {
      try {
        await ready(db)
        return await route(request, ctx)
      } catch (error) {
        if (error instanceof Problem) return json({ error: error.message }, error.status)
        console.error('[api]', error)
        return json({ error: 'Na serveru se něco pokazilo.' }, 500)
      }
    },
  }
}
