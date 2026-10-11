// The chat with the whole office. A request goes to the manager, who proposes how to split it;
// nothing is handed out until the plan is approved here.
import { el, fill, markdown, when, toast } from './dom.js'
import { S, api, act, changed, agentOf, taskOf, taskAction, openTask, face } from './store.js'

export function createChat(root) {
  const thread = el('div', { class: 'thread', role: 'log', 'aria-live': 'polite' })
  const input = el('textarea', { rows: 1, placeholder: 'Napiš kanceláři, co potřebuješ…', 'aria-label': 'Zpráva kanceláři', maxlength: 8000 })
  const send = el('button', { type: 'submit', class: 'btn primary', text: 'Poslat' })
  const toggle = el('button', { type: 'button', class: 'chat-toggle', 'aria-expanded': 'false', 'aria-label': 'Zobrazit konverzaci' })
  const form = el(
    'form',
    {
      class: 'chat-bar',
      onsubmit: async (e) => {
        e.preventDefault()
        const content = input.value.trim()
        if (!content || S.planning) return
        S.planning = true
        S.chat = true
        input.value = ''
        // Shown at once; the answer comes back with the fresh state when the manager has finished planning.
        S.data.messages.push({ id: 'pending', at: new Date().toISOString(), role: 'user', content })
        changed()
        try {
          S.data = await api('POST', '/api/chat', { content })
        } catch (err) {
          toast(err.message)
          S.data.messages = S.data.messages.filter((m) => m.id !== 'pending')
          input.value = content
        }
        S.planning = false
        changed()
      },
    },
    toggle,
    input,
    send,
  )
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      form.requestSubmit()
    }
  })
  input.addEventListener('focus', () => {
    if (!S.chat && S.data?.messages.length) {
      S.chat = true
      changed()
    }
  })
  toggle.addEventListener('click', () => {
    S.chat = !S.chat
    changed()
  })
  root.append(thread, form)

  let drawn = ''

  function planCard(m) {
    const task = m.task_id && taskOf(m.task_id)
    const proposed = m.plan_status === 'proposed' && task?.status === 'needs_approval'
    return el(
      'div',
      { class: 'plancard' },
      el(
        'ol',
        {},
        ...m.plan.tasks.map((t) => {
          const agent = agentOf(t.agent_id)
          const made = t.task_id && taskOf(t.task_id)
          return el(
            'li',
            {},
            made ? el('button', { type: 'button', class: 'linkish', text: t.title, onclick: () => openTask(made.id) }) : el('b', { text: t.title }),
            el('span', { class: 'who-line' }, agent && el('span', { class: 'mini', html: face(agent) }), el('span', { text: agent ? agent.role : t.agent_id })),
            t.depends_on.length ? el('small', { text: `až po: ${t.depends_on.map((k) => m.plan.tasks.find((x) => x.key === k)?.title || k).join(', ')}` }) : null,
          )
        }),
      ),
      proposed
        ? el(
            'div',
            { class: 'actions' },
            el('button', { type: 'button', class: 'btn primary', text: 'Schválit a rozdat úkoly', onclick: () => taskAction(m.task_id, 'approve') }),
            el('button', { type: 'button', class: 'btn', text: 'Zamítnout', onclick: () => taskAction(m.task_id, 'reject') }),
          )
        : el('small', { class: 'muted', text: m.plan_status === 'approved' ? 'Plán je schválený, úkoly jsou rozdané.' : 'Plán byl zamítnut.' }),
    )
  }

  return function refresh() {
    const d = S.data
    root.classList.toggle('open', S.chat)
    toggle.setAttribute('aria-expanded', String(S.chat))
    toggle.textContent = S.chat ? '▾' : '▴'
    send.disabled = S.planning
    send.textContent = S.planning ? 'Plánuje…' : 'Poslat'
    const key = JSON.stringify([d.messages.map((m) => [m.id, m.plan_status]), d.tasks.filter((t) => t.kind === 'plan' || t.plan_id).map((t) => [t.id, t.status]), S.planning, S.chat])
    if (key === drawn) return
    drawn = key
    if (!S.chat) return fill(thread)
    const manager = d.agents.find((a) => a.is_manager)
    fill(thread, 
      ...(d.messages.length
        ? d.messages.map((m) =>
            el(
              'div',
              { class: `msg ${m.role}` },
              m.role === 'manager' && manager && el('span', { class: 'mini', html: face(manager) }),
              el('div', { class: 'bubble' }, el('div', { class: 'prose', html: markdown(m.content) }), m.plan && planCard(m), el('time', { text: when(m.at) })),
            ),
          )
        : [el('p', { class: 'muted', text: 'Napiš, co potřebuješ. Manažer požadavek rozdělí na úkoly, ty mu plán schválíš a agenti se pustí do práce.' })]),
      S.planning && el('div', { class: 'msg manager' }, manager && el('span', { class: 'mini', html: face(manager) }), el('div', { class: 'bubble thinking', text: 'Manažer přemýšlí, jak práci rozdělit…' })),
    )
    thread.scrollTop = thread.scrollHeight
  }
}
