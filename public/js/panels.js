// The side panel: an agent (assign work, its tasks, history, settings) or one task (progress, result, approval).
import { el, fill, markdown, pill, field, select, toast, when, untilDue, localInput, duration, short, STATUS, AGENT_STATE, PRIORITY, IDLE, HAIR, PROPS } from './dom.js'
import { S, api, act, changed, agentOf, taskOf, tasksOf, depsOf, blockedBy, isRunning, agentState, face, modelName, startTask, taskAction, removeTask, openAgent, openTask, closePanel, onLive } from './store.js'

let current = null

export function renderPanel(root) {
  const p = S.panel
  const exists = p && (p.type === 'new-agent' || (p.type === 'agent' ? agentOf(p.id) : taskOf(p.id)))
  if (!exists) {
    if (p) S.panel = null
    current?.dispose?.()
    current = null
    root.hidden = true
    fill(root)
    return
  }
  const key = `${p.type}:${p.id || ''}:${p.tab || ''}`
  if (!current || current.key !== key) {
    current?.dispose?.()
    const built = p.type === 'agent' ? agentPanel(p) : p.type === 'task' ? taskPanel(p) : newAgentPanel()
    fill(root, el('button', { type: 'button', class: 'x', 'aria-label': 'Zavřít', text: '×', onclick: closePanel }), ...built.nodes.filter(Boolean))
    root.hidden = false
    root.scrollTop = 0
    current = { key, ...built }
  }
  current.refresh?.()
}

const notice = (kind, text) => el('p', { class: `notice ${kind}`, text })

// Says plainly why a task given now would not start right away.
function hurdles() {
  const d = S.data
  const out = []
  if (!d.ai.provider) out.push(notice('warn', 'Není nastaven žádný AI poskytovatel. Úkol se uloží do fronty, ale nikdo ho nezpracuje, dokud na serveru nenastavíš ANTHROPIC_API_KEY (nebo v Nastavení nezapneš vývojový režim).'))
  else if (d.ai.provider === 'dev') out.push(notice('warn', 'Vývojový režim: úkol projde celým postupem, ale výsledek je ukázkový text, žádná AI ho nepíše.'))
  if (!d.open) out.push(notice('info', `Kancelář je zavřená do ${String(d.hours[0]).padStart(2, '0')}:00. Úkol počká ve frontě a spustí se ráno.`))
  return out
}

// ---------- new task ----------
export function taskForm({ agentId = null, onDone } = {}) {
  const others = S.data.tasks.filter((t) => t.kind === 'task' && !['cancelled'].includes(t.status))
  const files = el('input', { type: 'file', multiple: true, accept: '.txt,.md,.csv,.json,.html,.xml,.yaml,.yml,text/*' })
  const deps = el('select', { name: 'depends_on', multiple: true, size: Math.min(4, Math.max(2, others.length)) }, ...others.map((t) => el('option', { value: t.id, text: `${short(t.title, 48)} · ${STATUS[t.status]}` })))
  const form = el(
    'form',
    {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault()
        const data = Object.fromEntries(new FormData(form))
        const start = e.submitter?.value !== 'queue'
        const attachments = []
        for (const f of files.files) {
          if (f.size > 200_000) return toast(`Příloha ${f.name} je větší než 200 kB. Přikládat jde jen menší textové soubory.`)
          attachments.push({ name: f.name, content: await f.text() })
        }
        const body = { ...data, agent_id: agentId || data.agent_id, due_at: data.due_at ? new Date(data.due_at).toISOString() : null, depends_on: [...deps.selectedOptions].map((o) => o.value), attachments, start }
        if (await act(() => api('POST', '/api/tasks', body))) {
          form.reset()
          onDone?.()
        }
      },
    },
    !agentId && field('Komu', select('agent_id', S.data.agents.map((a) => [a.id, `${a.role} · ${a.department}`]))),
    field('Zadání', el('textarea', { name: 'description', required: true, rows: 4, maxlength: 20000, placeholder: 'Co má udělat? Piš normálně, jako kolegovi.' })),
    el('div', { class: 'pair' }, field('Priorita', select('priority', Object.entries(PRIORITY), 'normal')), field('Termín', el('input', { type: 'datetime-local', name: 'due_at' }))),
    el(
      'details',
      {},
      el('summary', { text: 'Název, kontext, přílohy a návaznosti' }),
      field('Název', el('input', { name: 'title', maxlength: 160, placeholder: 'Když ho nevyplníš, vezme se první řádek zadání' })),
      field('Kontext a požadavky', el('textarea', { name: 'context', rows: 3, maxlength: 40000, placeholder: 'Podklady, omezení, na co si dát pozor' })),
      field('Přílohy', files, 'Textové soubory do 200 kB, nejvýše 5.'),
      others.length ? field('Navazuje na', deps, 'Spustí se, až budou vybrané úkoly schválené, a dostane jejich výsledky.') : null,
    ),
    el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary', value: 'start', text: 'Zadat a spustit' }), el('button', { type: 'submit', class: 'btn', value: 'queue', text: 'Jen do fronty' })),
  )
  return form
}

const taskRow = (t, withAgent = false) =>
  el(
    'button',
    { type: 'button', class: `row s-${t.status}`, onclick: () => openTask(t.id) },
    pill(t.status),
    el('span', { class: 'row-title', text: t.title }),
    el('span', { class: 'row-meta', text: [withAgent && agentOf(t.agent_id)?.role, t.priority !== 'normal' && PRIORITY[t.priority], t.due_at && untilDue(t.due_at), when(t.updated_at)].filter(Boolean).join(' · ') }),
  )
export { taskRow }

const eventRow = (e) => el('li', { class: `event a-${e.actor}` }, el('time', { text: when(e.at) }), el('span', { text: e.message }))
export { eventRow }

// ---------- agent settings ----------
function agentForm(agent) {
  const a = agent || { name: '', role: '', department: '', description: '', instructions: '', model: '', web_search: 1, is_manager: 0, color: '#4f6bff', look: { avatar: 'helper', eyes: 2, hair: 'tuft', prop: 'none' }, idle: 'auto' }
  const ai = S.data.ai
  const departments = [...new Set(S.data.agents.map((x) => x.department))]
  const instructions = el('textarea', { name: 'instructions', required: true, rows: 14, spellcheck: 'false', class: 'mono', placeholder: 'Kdo to je, co dělá, jak má pracovat a co nesmí.' })
  instructions.value = a.instructions
  const description = el('textarea', { name: 'description', rows: 3, maxlength: 1000 })
  description.value = a.description
  const check = (name, on, label) => el('label', { class: 'check' }, el('input', { type: 'checkbox', name, checked: Boolean(on) }), el('span', { text: label }))
  const form = el(
    'form',
    {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault()
        const d = Object.fromEntries(new FormData(form))
        const body = {
          name: d.name, role: d.role, department: d.department, description: d.description, instructions: d.instructions, model: d.model, color: d.color, idle: d.idle,
          web_search: 'web_search' in d, is_manager: 'is_manager' in d,
          look: { avatar: d.avatar, eyes: d.eyes, hair: d.hair, prop: d.prop },
        }
        const ok = await act(() => (agent ? api('PATCH', `/api/agents/${agent.id}`, body) : api('POST', '/api/agents', body)))
        if (!ok) return
        toast(agent ? 'Uloženo.' : 'Agent nastoupil do kanceláře.', 'ok')
        if (!agent) {
          const made = S.data.agents.find((x) => x.name === d.name && x.role === d.role)
          if (made) openAgent(made.id)
        }
      },
    },
    el('div', { class: 'pair' }, field('Role (cedulka na stole)', el('input', { name: 'role', value: a.role, required: true, maxlength: 60 })), field('Jméno', el('input', { name: 'name', value: a.name, required: true, maxlength: 80 }))),
    field('Oddělení', el('input', { name: 'department', value: a.department, required: true, maxlength: 60, list: 'departments' }), 'Nové jméno otevře v kanceláři novou zónu.'),
    el('datalist', { id: 'departments' }, ...departments.map((n) => el('option', { value: n }))),
    field('Odpovědnost', description, 'Podle toho manažer pozná, komu co zadat.'),
    el('div', { class: 'pair' }, field('AI model', select('model', [['', `Výchozí (${ai.models.find((m) => m.id === ai.defaultModel)?.name || ai.defaultModel})`], ...ai.models.map((m) => [m.id, m.name])], a.model)), field('Když má volno', select('idle', IDLE, a.idle))),
    check('web_search', a.web_search, 'Smí hledat na webu'),
    check('is_manager', a.is_manager, 'Je manažer: rozděluje požadavky z chatu'),
    el(
      'div',
      { class: 'quad' },
      field('Postava', select('avatar', [['helper', 'Pomocník'], ['claude', 'Šéf']], a.look.avatar)),
      field('Oči', select('eyes', [[1, '1'], [2, '2']], a.look.eyes)),
      field('Vlasy', select('hair', HAIR.map((h) => [h, h]), a.look.hair)),
      field('Drží', select('prop', PROPS.map((h) => [h, h]), a.look.prop)),
    ),
    field('Barva', el('input', { type: 'color', name: 'color', value: a.color })),
    field('Systémové instrukce', instructions),
    el(
      'div',
      { class: 'actions' },
      el('button', { type: 'submit', class: 'btn primary', text: agent ? 'Uložit' : 'Přijmout do kanceláře' }),
      agent &&
        el('button', {
          type: 'button',
          class: 'btn danger',
          text: 'Propustit',
          onclick: async () => {
            if (confirm(`Opravdu má ${agent.role} odejít z kanceláře? Jeho čekající úkoly se zruší.`)) await act(() => api('DELETE', `/api/agents/${agent.id}`), closePanel)
          },
        }),
    ),
  )
  return form
}

function newAgentPanel() {
  return { nodes: [el('div', { class: 'who' }, el('div', {}, el('h2', { id: 'panel-title', text: 'Nový agent' }), el('p', { text: 'Dostane vlastní stůl a můžeš mu hned zadávat práci.' }))), agentForm(null)] }
}

// ---------- agent ----------
function agentPanel(p) {
  const a = agentOf(p.id)
  const badge = el('span', { class: 'badge' })
  const model = el('span', { class: 'chip' })
  const head = el('div', { class: 'who' }, el('div', { class: 'face', html: face(a) }), el('div', {}, el('h2', { id: 'panel-title', text: a.role }), el('p', { text: `${a.name} · ${a.department}` }), el('div', { class: 'meta' }, badge, model)))
  const count = el('span', { class: 'count' })
  const tabs = el(
    'nav',
    { class: 'tabs', 'aria-label': 'Části profilu' },
    ...[['assign', 'Zadat úkol'], ['tasks', 'Úkoly'], ['history', 'Historie'], ['settings', 'Nastavení']].map(([id, label]) =>
      el('button', { type: 'button', 'aria-pressed': String(p.tab === id), onclick: () => openAgent(p.id, id) }, label, id === 'tasks' && count),
    ),
  )
  const body = el('div', { class: 'tabbody' })
  let refreshBody = () => {}

  if (p.tab === 'assign') {
    const hints = el('div', {})
    const now = el('div', {})
    const idle = el('div', { class: 'acts', role: 'group', 'aria-label': 'Když má volno' })
    body.append(hints, taskForm({ agentId: a.id }), el('h3', { text: 'Právě teď' }), now, el('h3', { text: 'Když má volno' }), idle)
    refreshBody = () => {
      const fresh = agentOf(p.id)
      fill(hints, ...hurdles())
      const st = agentState(a.id)
      const open = tasksOf(a.id).filter((t) => !['completed', 'cancelled'].includes(t.status)).reverse()
      fill(now, ...(open.length ? open.map((t) => taskRow(t)) : [el('p', { class: 'muted', text: st.state === 'idle' ? 'Nemá žádný rozdělaný úkol.' : '' })]))
      fill(idle, ...IDLE.map(([id, label]) => el('button', { type: 'button', class: 'chipbtn', 'aria-pressed': String(fresh.idle === id), text: label, onclick: () => act(() => api('PATCH', `/api/agents/${a.id}`, { idle: id })) })))
    }
  } else if (p.tab === 'tasks') {
    refreshBody = () => {
      const mine = tasksOf(a.id).slice().reverse()
      fill(body, ...(mine.length ? mine.map((t) => taskRow(t)) : [el('p', { class: 'muted', text: 'Zatím nedostal žádný úkol.' })]))
    }
  } else if (p.tab === 'history') {
    const list = el('ul', { class: 'events' })
    body.append(list)
    let older = []
    api('GET', `/api/events?agent=${encodeURIComponent(a.id)}`).then((r) => ((older = r.events), refreshBody())).catch(() => {})
    refreshBody = () => {
      const seen = new Set()
      const all = [...S.data.events.filter((e) => e.agent_id === a.id), ...older].filter((e) => !seen.has(e.id) && seen.add(e.id)).sort((x, y) => y.id - x.id)
      fill(list, ...(all.length ? all.map(eventRow) : [el('li', { class: 'muted', text: 'Zatím žádná aktivita.' })]))
    }
  } else {
    body.append(agentForm(a))
  }

  return {
    nodes: [head, tabs, body],
    refresh() {
      const st = agentState(a.id)
      badge.className = `badge st-${S.data.open ? st.state : 'sleep'}`
      badge.textContent = S.data.open ? AGENT_STATE[st.state] : 'Spí'
      model.textContent = S.data.ai.provider === 'dev' ? 'Vývojový režim' : modelName(agentOf(p.id))
      count.textContent = tasksOf(a.id).filter((t) => !['completed', 'cancelled'].includes(t.status)).length || ''
      refreshBody()
    },
  }
}

// ---------- task ----------
function taskPanel(p) {
  let detail = null
  let seenAt = ''
  let loading = false
  let editing = false
  let rejecting = false
  let paintQueued = false
  let reviewKey = ''

  const back = p.from && agentOf(p.from) ? el('button', { type: 'button', class: 'back', text: `← ${agentOf(p.from).role}`, onclick: () => openAgent(p.from) }) : null
  const title = el('h2', { id: 'panel-title' })
  const meta = el('div', { class: 'meta' })
  const actions = el('div', { class: 'actions' })
  const notes = el('div', {})
  const review = el('div', {})
  const brief = el('div', {})
  const resultHead = el('h3', {})
  const result = el('div', { class: 'prose result' })
  const extra = el('div', {})

  const button = (text, run, cls = 'btn') => el('button', { type: 'button', class: cls, text, onclick: run })

  async function fetchDetail() {
    if (loading) return
    loading = true
    try {
      detail = await api('GET', `/api/tasks/${p.id}`)
      seenAt = detail.task.updated_at
      paint()
    } catch {} finally {
      loading = false
    }
  }

  function paintResult() {
    paintQueued = false
    const t = taskOf(p.id)
    if (!t) return
    const text = S.live.has(p.id) ? S.live.get(p.id) : detail?.task.result || ''
    const running = isRunning(t)
    resultHead.textContent = t.kind === 'plan' ? 'Navržený plán' : running ? 'Průběh' : 'Výsledek'
    resultHead.hidden = result.hidden = !text && !running
    result.innerHTML = text ? markdown(text) : '<p class="muted">Zatím nic nenapsal.</p>'
    if (running) result.scrollIntoView({ block: 'nearest' })
  }
  const queuePaint = () => {
    if (paintQueued) return
    paintQueued = true
    setTimeout(paintResult, 250)
  }
  const stopLive = onLive((id) => id === p.id && queuePaint())

  function editForm(t) {
    const others = S.data.tasks.filter((x) => x.kind === 'task' && x.id !== t.id && x.status !== 'cancelled')
    const mine = new Set(depsOf(t.id).map((x) => x.id))
    const description = el('textarea', { name: 'description', required: true, rows: 6 })
    description.value = detail.task.description
    const context = el('textarea', { name: 'context', rows: 3 })
    context.value = detail.task.context
    const deps = el('select', { multiple: true, size: Math.min(4, Math.max(2, others.length)) }, ...others.map((x) => el('option', { value: x.id, selected: mine.has(x.id), text: `${short(x.title, 48)} · ${STATUS[x.status]}` })))
    const form = el(
      'form',
      {
        class: 'form',
        onsubmit: async (e) => {
          e.preventDefault()
          const d = Object.fromEntries(new FormData(form))
          const ok = await act(() => api('PATCH', `/api/tasks/${t.id}`, { ...d, due_at: d.due_at ? new Date(d.due_at).toISOString() : null, depends_on: [...deps.selectedOptions].map((o) => o.value) }))
          if (ok) {
            editing = false
            seenAt = ''
            refresh()
          }
        },
      },
      field('Název', el('input', { name: 'title', value: t.title, required: true, maxlength: 160 })),
      field('Zadání', description),
      field('Kontext a požadavky', context),
      el('div', { class: 'pair' }, field('Priorita', select('priority', Object.entries(PRIORITY), t.priority)), field('Termín', el('input', { type: 'datetime-local', name: 'due_at', value: localInput(t.due_at) }))),
      field('Kdo to udělá', select('agent_id', S.data.agents.map((a) => [a.id, `${a.role} · ${a.department}`]), t.agent_id)),
      others.length ? field('Navazuje na', deps) : null,
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary', text: 'Uložit zadání' }), button('Zpět', () => ((editing = false), paint()))),
    )
    return form
  }

  function paint() {
    const t = taskOf(p.id)
    if (!t) return
    const agent = agentOf(t.agent_id)
    title.textContent = t.title
    fill(meta, 
      pill(t.status),
      agent && el('button', { type: 'button', class: 'chip link', text: agent.role, onclick: () => openAgent(agent.id) }),
      t.kind === 'task' && el('span', { class: 'chip', text: `Priorita: ${PRIORITY[t.priority]}` }),
      t.due_at && el('span', { class: 'chip', text: `Termín ${untilDue(t.due_at)}` }),
      t.revision > 1 && el('span', { class: 'chip', text: `${t.revision}. verze` }),
      el('span', { class: 'chip', text: `Zadáno ${when(t.created_at)}` }),
    )

    const blockers = blockedBy(t)
    const ai = S.data.ai
    const can = {
      edit: t.kind === 'task' && ['queued', 'paused', 'error'].includes(t.status),
      remove: !isRunning(t),
    }
    const list = []
    if (t.kind === 'task') {
      if (t.status === 'queued' && !t.auto) list.push(button('Spustit', () => startTask(t.id), 'btn primary'))
      if (t.status === 'paused') list.push(button('Pokračovat', () => taskAction(t.id, 'resume'), 'btn primary'))
      if (['queued', 'thinking', 'working'].includes(t.status)) list.push(button('Pozastavit', () => taskAction(t.id, 'pause')))
      if (['error', 'cancelled'].includes(t.status)) list.push(button(t.status === 'error' ? 'Zkusit znovu' : 'Obnovit', () => taskAction(t.id, 'retry'), 'btn primary'))
    }
    if (['queued', 'paused', 'thinking', 'working', 'error'].includes(t.status)) list.push(button('Zrušit', () => taskAction(t.id, 'cancel')))
    if (can.edit && !editing && detail) list.push(button('Upravit zadání', () => ((editing = true), paint())))
    if (can.remove) list.push(button('Smazat', async () => confirm('Smazat úkol i s jeho výsledky?') && (await removeTask(t.id)), 'btn danger'))
    fill(actions, ...list)

    const hints = []
    if (t.status === 'error') hints.push(notice('bad', t.error || 'Úkol skončil chybou.'))
    if (t.status === 'queued' && t.auto) {
      if (blockers.length) hints.push(notice('info', `Čeká, až schválíš: ${blockers.map((b) => `„${b.title}“`).join(', ')}.`))
      else if (!ai.provider) hints.push(notice('warn', 'Nespustí se, dokud není nastaven AI poskytovatel (ANTHROPIC_API_KEY na serveru) nebo zapnutý vývojový režim.'))
      else if (!S.data.open) hints.push(notice('info', `Kancelář je zavřená. Spustí se po ${String(S.data.hours[0]).padStart(2, '0')}:00.`))
      else if (agent && tasksOf(agent.id).some((x) => x.id !== t.id && isRunning(x))) hints.push(notice('info', `${agent.role} teď dělá na jiném úkolu, tenhle je další na řadě.`))
      else hints.push(notice('info', 'Za okamžik se spustí.'))
    }
    if (t.status === 'queued' && !t.auto) hints.push(notice('info', 'Je ve frontě a čeká, až ho spustíš.'))
    if (isRunning(t)) hints.push(notice('info', t.activity || STATUS[t.status]))
    const lastRun = detail?.runs[0]
    if (lastRun?.provider === 'dev' && ['needs_approval', 'completed'].includes(t.status)) hints.push(notice('warn', 'Ukázkový výstup z vývojového režimu. Tento text nenapsala AI.'))
    fill(notes, ...hints)

    // Rebuilt only when it has to be, so comments being typed keep their cursor.
    const key = `${t.status}:${t.kind}:${rejecting}`
    if (key === reviewKey) {
    } else if (t.status === 'needs_approval') {
      reviewKey = key
      const area = el('textarea', { rows: 3, placeholder: 'Co má udělat jinak?', 'aria-label': 'Připomínky' })
      fill(review, 
        el(
          'div',
          { class: 'review' },
          el('p', { text: t.kind === 'plan' ? 'Manažer navrhl, jak požadavek rozdělit. Po schválení se úkoly rozdají a začnou se plnit.' : 'Výsledek čeká na tvoje schválení.' }),
          el(
            'div',
            { class: 'actions' },
            button(t.kind === 'plan' ? 'Schválit a rozdat úkoly' : 'Schválit', () => taskAction(t.id, 'approve'), 'btn primary'),
            t.kind === 'plan' ? button('Zamítnout', () => taskAction(t.id, 'reject')) : button(rejecting ? 'Zpět' : 'Vrátit k přepracování', () => ((rejecting = !rejecting), paint())),
          ),
          rejecting && t.kind === 'task' && area,
          rejecting && t.kind === 'task' && button('Poslat připomínky', async () => area.value.trim() ? (await taskAction(t.id, 'reject', { feedback: area.value })) && (rejecting = false) : toast('Napiš, co má být jinak.'), 'btn primary'),
        ),
      )
    } else {
      rejecting = false
      reviewKey = `${t.status}:${t.kind}:false`
      fill(review)
    }

    if (detail) {
      if (editing && can.edit) {
        if (!brief.querySelector('form')) fill(brief, el('h3', { text: 'Zadání' }), editForm(t))
      } else {
        editing = false
        const deps = detail.deps
        fill(brief, 
          el('h3', { text: t.kind === 'plan' ? 'Požadavek z chatu' : 'Zadání' }),
          el('div', { class: 'prose', html: markdown(detail.task.description) }),
          detail.task.context && el('h3', { text: 'Kontext a požadavky' }),
          detail.task.context && el('div', { class: 'prose', html: markdown(detail.task.context) }),
          detail.task.feedback && t.revision > 1 && el('h3', { text: 'Poslední připomínky' }),
          detail.task.feedback && t.revision > 1 && el('div', { class: 'prose', html: markdown(detail.task.feedback) }),
          deps.length ? el('h3', { text: 'Navazuje na' }) : null,
          ...deps.map((d) => taskRow(taskOf(d.id) || d)),
          detail.attachments.length ? el('h3', { text: 'Přílohy' }) : null,
          detail.attachments.length ? el('ul', { class: 'chips' }, ...detail.attachments.map((f) => el('li', { text: `${f.name} · ${Math.ceil(f.size / 1000)} kB` }))) : null,
          detail.plan && el('h3', { text: 'Úkoly v plánu' }),
          detail.plan && el('ol', { class: 'plan' }, ...detail.plan.tasks.map((x) => el('li', {}, el('b', { text: x.title }), el('span', { text: ` → ${agentOf(x.agent_id)?.role || x.agent_id}` }), el('p', { text: x.description })))),
        )
      }
      fill(extra, 
        (t.status === 'needs_approval' || t.status === 'completed') && detail.task.result
          ? el('div', { class: 'actions' }, button('Kopírovat výsledek', () => navigator.clipboard.writeText(detail.task.result).then(() => toast('Zkopírováno.', 'ok'), () => toast('Kopírování se nepovedlo.'))))
          : null,
        detail.runs.length ? el('h3', { text: 'Běhy' }) : null,
        detail.runs.length
          ? el(
              'ul',
              { class: 'runs' },
              ...detail.runs.map((r) =>
                el(
                  'li',
                  {},
                  el('b', { text: `${r.revision}. verze · ${{ done: 'dokončeno', running: 'běží', error: 'chyba', cancelled: 'zastaveno' }[r.status] || r.status}` }),
                  el('span', { text: [when(r.started_at), duration(r.started_at, r.finished_at), r.provider === 'dev' ? 'vývojový režim' : r.model, r.output_tokens ? `${r.input_tokens} + ${r.output_tokens} tokenů` : ''].filter(Boolean).join(' · ') }),
                  r.error && el('span', { class: 'bad', text: r.error }),
                ),
              ),
            )
          : null,
        el('h3', { text: 'Historie změn' }),
        el('ul', { class: 'events' }, ...detail.events.map(eventRow)),
      )
    }
    paintResult()
  }

  function refresh() {
    const t = taskOf(p.id)
    if (!t) return
    paint()
    if (!detail || t.updated_at !== seenAt || (isRunning(t) && !S.live.has(p.id))) fetchDetail()
  }

  return { nodes: [back, el('div', { class: 'who plain' }, el('div', {}, title, meta)), actions, notes, review, brief, resultHead, result, extra], refresh, dispose: stopLive }
}
