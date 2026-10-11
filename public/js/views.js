// The sheets that slide over the office: tasks (board and list), approvals, history, settings.
import { el, fill, pill, select, field, toast, when, untilDue, short, PRIORITY, STATUS, AGENT_STATE } from './dom.js'
import { S, api, act, changed, agentOf, agentState, blockedBy, face, modelName, taskAction, openTask, openAgent, openSheet } from './store.js'
import { taskForm, taskRow, eventRow } from './panels.js'

const TITLES = { tasks: 'Úkoly', approvals: 'Ke schválení', history: 'Historie', settings: 'Nastavení' }
const COLUMNS = [
  ['Čeká', ['queued', 'paused']],
  ['Běží', ['thinking', 'working']],
  ['Ke schválení', ['needs_approval']],
  ['Hotovo', ['completed']],
  ['Problém', ['error', 'cancelled']],
]

let current = null
const ui = { mode: 'board', agent: '', adding: false, historyAgent: '' }

export function renderSheet(root) {
  if (!S.sheet) {
    root.hidden = true
    fill(root)
    current = null
    return
  }
  if (current?.name !== S.sheet) {
    const build = { tasks, approvals, history, settings }[S.sheet]
    const body = el('div', { class: 'sheet-body' })
    const tools = el('div', { class: 'sheet-tools' })
    fill(root, el('header', { class: 'sheet-head' }, el('h2', { text: TITLES[S.sheet] }), tools, el('button', { type: 'button', class: 'x', 'aria-label': 'Zavřít', text: '×', onclick: () => openSheet(S.sheet) })), body)
    root.hidden = false
    current = { name: S.sheet, refresh: build(body, tools) }
  }
  current.refresh()
}

const agentFilter = (value, onpick) => {
  const s = select('agent', [['', 'Všichni agenti'], ...S.data.agents.map((a) => [a.id, a.role])], value)
  s.setAttribute('aria-label', 'Agent')
  s.addEventListener('change', () => onpick(s.value))
  return s
}

function card(t) {
  const a = agentOf(t.agent_id)
  const waits = t.status === 'queued' ? blockedBy(t) : []
  return el(
    'button',
    { type: 'button', class: `card p-${t.priority}`, onclick: () => openTask(t.id) },
    el('span', { class: 'card-title', text: t.title }),
    el('span', { class: 'card-who' }, a && el('span', { class: 'mini', html: face(a) }), el('span', { text: a ? a.role : 'Bez agenta' })),
    el(
      'span',
      { class: 'card-meta' },
      t.kind === 'plan' && el('span', { class: 'tagline', text: 'Plán' }),
      t.priority !== 'normal' && el('span', { class: `tagline p-${t.priority}`, text: PRIORITY[t.priority] }),
      t.due_at && el('span', { class: 'tagline', text: untilDue(t.due_at) }),
      waits.length ? el('span', { class: 'tagline', text: `čeká na ${waits.length}` }) : null,
      t.status === 'paused' && el('span', { class: 'tagline', text: 'pozastaveno' }),
      t.status === 'cancelled' && el('span', { class: 'tagline', text: 'zrušeno' }),
      ['thinking', 'working'].includes(t.status) && el('span', { class: 'tagline live', text: t.activity || STATUS[t.status] }),
    ),
  )
}

function tasks(body, tools) {
  const area = el('div', {})
  const adder = el('div', {})
  body.append(adder, area)
  const drawTools = () => {
    fill(tools, 
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Zobrazení' }, ...[['board', 'Nástěnka'], ['list', 'Seznam']].map(([id, label]) => el('button', { type: 'button', 'aria-pressed': String(ui.mode === id), text: label, onclick: () => ((ui.mode = id), drawTools(), refresh()) }))),
      agentFilter(ui.agent, (v) => ((ui.agent = v), refresh())),
      el('button', { type: 'button', class: 'btn primary', text: ui.adding ? 'Zavřít formulář' : 'Nový úkol', onclick: () => ((ui.adding = !ui.adding), drawTools(), drawAdder()) }),
    )
  }
  const drawAdder = () => fill(adder, ...(ui.adding ? [el('div', { class: 'adder' }, taskForm({ onDone: () => ((ui.adding = false), drawTools(), drawAdder()) }))] : []))
  function refresh() {
    const list = S.data.tasks.filter((t) => !ui.agent || t.agent_id === ui.agent)
    if (ui.mode === 'board') {
      area.className = 'board'
      fill(area, 
        ...COLUMNS.map(([name, states]) => {
          const items = list.filter((t) => states.includes(t.status)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          return el('section', { class: 'col' }, el('h3', {}, name, el('span', { class: 'count', text: String(items.length) })), ...(items.length ? items.map(card) : [el('p', { class: 'muted', text: 'Nic.' })]))
        }),
      )
    } else {
      area.className = 'list'
      const items = list.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      fill(area, ...(items.length ? items.map((t) => taskRow(t, true)) : [el('p', { class: 'muted', text: 'Zatím tu žádný úkol není. Klikni na agenta v kanceláři a zadej mu práci.' })]))
    }
  }
  drawTools()
  drawAdder()
  return refresh
}

function approvals(body) {
  return () => {
    const waiting = S.data.tasks.filter((t) => t.status === 'needs_approval').sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    fill(body, 
      ...(waiting.length
        ? waiting.map((t) => {
            const a = agentOf(t.agent_id)
            return el(
              'article',
              { class: 'approval' },
              el('div', { class: 'card-who' }, a && el('span', { class: 'mini', html: face(a) }), el('span', { text: `${a ? a.role : ''} · ${when(t.updated_at)}` })),
              el('h3', { text: t.title }),
              el('p', { class: 'preview', text: short(t.preview || '', 280) }),
              el(
                'div',
                { class: 'actions' },
                el('button', { type: 'button', class: 'btn primary', text: t.kind === 'plan' ? 'Schválit a rozdat úkoly' : 'Schválit', onclick: () => taskAction(t.id, 'approve') }),
                el('button', { type: 'button', class: 'btn', text: 'Otevřít celý výsledek', onclick: () => openTask(t.id) }),
              ),
            )
          })
        : [el('p', { class: 'muted', text: 'Nic nečeká na schválení.' })]),
    )
  }
}

function history(body, tools) {
  const list = el('ul', { class: 'events wide' })
  body.append(list)
  let older = []
  const fetchOlder = () =>
    api('GET', `/api/events${ui.historyAgent ? `?agent=${encodeURIComponent(ui.historyAgent)}` : ''}`)
      .then((r) => ((older = r.events), refresh()))
      .catch(() => {})
  fill(tools, agentFilter(ui.historyAgent, (v) => ((ui.historyAgent = v), (older = []), fetchOlder())))
  function refresh() {
    const seen = new Set()
    const all = [...S.data.events, ...older].filter((e) => (!ui.historyAgent || e.agent_id === ui.historyAgent) && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => b.id - a.id)
    fill(list, 
      ...(all.length
        ? all.map((e) => {
            const row = eventRow(e)
            const a = e.agent_id && agentOf(e.agent_id)
            if (a) row.prepend(el('span', { class: 'mini', html: face(a) }))
            if (e.task_id && S.data.tasks.some((t) => t.id === e.task_id)) {
              row.classList.add('clickable')
              row.addEventListener('click', () => openTask(e.task_id))
            }
            return row
          })
        : [el('li', { class: 'muted', text: 'Zatím se nic nestalo.' })]),
    )
  }
  fetchOlder()
  return refresh
}

function settings(body) {
  const aiBox = el('section', { class: 'box' })
  const staffBox = el('section', { class: 'box' })
  const hoursBox = el('section', { class: 'box' })
  const accountBox = el('section', { class: 'box' })
  body.append(aiBox, staffBox, hoursBox, accountBox)
  let key = ''
  return () => {
    const d = S.data
    const ai = d.ai
    // The AI box holds form controls, so it is redrawn only when its content really changed.
    const nextKey = JSON.stringify([ai.provider, ai.dev, ai.defaultModel, ai.providers])
    if (nextKey !== key) {
      key = nextKey
      const model = select('default_model', ai.models.map((m) => [m.id, m.name]), ai.defaultModel)
      model.addEventListener('change', () => act(() => api('PUT', '/api/settings', { default_model: model.value })))
      const dev = el('input', { type: 'checkbox', checked: ai.dev })
      dev.addEventListener('change', () => act(() => api('PUT', '/api/settings', { dev_mode: dev.checked })))
      fill(aiBox, 
        el('h3', { text: 'AI poskytovatelé' }),
        ...ai.providers.map((p) =>
          el(
            'div',
            { class: 'provider' },
            el('b', { text: p.name }),
            el('span', { class: `badge ${p.configured ? 'st-working' : 'st-error'}`, text: p.configured ? 'Připojeno' : 'Nenastaveno' }),
            el('p', {
              class: 'muted',
              text: p.configured
                ? 'Klíč je uložený jen na serveru. Do prohlížeče se nikdy neposílá.'
                : d.local
                  ? `Vytvoř ve složce projektu soubor .env s řádkem ${p.variable}=tvůj-klíč a spusť kancelář znovu.`
                  : `Na Cloudflare přidej tajnou proměnnou ${p.variable} (Workers → agency → Settings → Variables and Secrets) a nasaď znovu.`,
            }),
          ),
        ),
        field('Výchozí model', model, 'Použije se u agentů, kteří nemají vlastní model.'),
        el('label', { class: 'check' }, dev, el('span', { text: 'Vývojový režim: bez AI, úkoly vracejí označený ukázkový text' })),
        el('p', { class: 'muted', text: ai.provider === 'anthropic' ? 'Úkoly zpracovává Claude přes Anthropic API.' : ai.provider === 'dev' ? 'Teď běží vývojový režim. Žádný výsledek nepíše AI.' : 'Teď úkoly nikdo nezpracuje: chybí klíč a vývojový režim je vypnutý.' }),
      )
    }
    fill(staffBox, 
      el('h3', { text: 'Agenti' }),
      ...d.agents.map((a) =>
        el(
          'button',
          { type: 'button', class: 'row', onclick: () => openAgent(a.id, 'settings') },
          el('span', { class: 'mini', html: face(a) }),
          el('span', { class: 'row-title', text: `${a.role}${a.is_manager ? ' · manažer' : ''}` }),
          el('span', { class: 'row-meta', text: [a.department, modelName(a), a.web_search ? 'hledání na webu' : '', AGENT_STATE[agentState(a.id).state]].filter(Boolean).join(' · ') }),
        ),
      ),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', text: 'Přidat agenta', onclick: () => ((S.panel = { type: 'new-agent' }), changed()) })),
    )
    const pad = (n) => String(n).padStart(2, '0')
    fill(hoursBox, el('h3', { text: 'Pracovní doba' }), el('p', { class: 'muted', text: `Kancelář pracuje ${pad(d.hours[0])}:00–${pad(d.hours[1])}:00 pražského času. Mimo tuto dobu server žádný úkol nespustí; úkoly zadané v noci počkají na ráno.` }))
    fill(accountBox, 
      el('h3', { text: 'Přístup' }),
      S.session.required
        ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Odhlásit se', onclick: () => api('POST', '/api/logout').then(() => location.reload(), (e) => toast(e.message)) }))
        : el('p', { class: 'muted', text: 'Kancelář běží jen na tomto počítači, proto se nepřihlašuje. Po nasazení na web ji chrání heslo ADMIN_PASSWORD.' }),
    )
  }
}
