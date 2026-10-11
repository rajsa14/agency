// Starts the office and keeps the scene, the staff list, the panels and the chat in step with the server.
import { el, fill, AGENT_STATE, toast } from './dom.js'
import { S, api, load, onChange, changed, agentState, counts, face, openAgent, closePanel, openSheet } from './store.js'
import { createScene } from './scene.js'
import { renderPanel } from './panels.js'
import { renderSheet } from './views.js'
import { createChat } from './chat.js'

const $ = (id) => document.getElementById(id)
const pad = (n) => String(n).padStart(2, '0')

// ?time=23:30 previews how the office looks at another hour. It changes the picture only; the server keeps real time.
const previewShift = (() => {
  const m = new URLSearchParams(location.search).get('time')?.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  const d = new Date()
  d.setHours(+m[1], +m[2], 0, 0)
  return d - Date.now()
})()
const now = () => new Date(Date.now() + previewShift)
const looksOpen = () => (previewShift ? now().getHours() >= 6 && now().getHours() < 22 : S.data ? S.data.open : S.session?.open ?? true)

const scene = createScene({
  canvas: $('scene'),
  tags: $('tags'),
  onPick: (id) => {
    if (!S.session?.authed) return
    if (id) openAgent(id)
    else if (S.panel) closePanel()
  },
})

const refreshChat = createChat($('chat'))
const isPhone = () => innerWidth <= 820

const NAV = [
  ['tasks', 'Úkoly', (c) => c.open],
  ['approvals', 'Schválení', (c) => c.review],
  ['history', 'Historie', () => 0],
  ['settings', 'Nastavení', () => 0],
]

function drawNav() {
  const c = counts()
  fill($('nav'), 
    el('button', { type: 'button', 'aria-pressed': String(!S.sheet), text: 'Kancelář', onclick: () => S.sheet && openSheet(S.sheet) }),
    ...NAV.map(([id, label, count]) =>
      el('button', { type: 'button', 'aria-pressed': String(S.sheet === id), class: id === 'approvals' && c.review ? 'alert' : '', onclick: () => openSheet(id) }, label, count(c) ? el('span', { class: 'count', text: String(count(c)) }) : null),
    ),
  )
}

function drawRail() {
  const open = looksOpen()
  fill($('rail'), 
    ...S.data.agents.map((a) => {
      const st = agentState(a.id)
      const state = open ? st.state : 'sleep'
      return el(
        'button',
        { type: 'button', class: `staff st-${state}`, 'aria-pressed': String(S.panel?.type === 'agent' && S.panel.id === a.id), title: a.name, onclick: () => openAgent(a.id) },
        el('span', { class: 'mini', html: face(a) }),
        el('span', { class: 'staff-text' }, el('b', { text: a.role }), el('small', { text: open ? st.text || AGENT_STATE[st.state] : 'Spí' })),
        el('i', { class: 'dot' }),
      )
    }),
  )
}

function drawClock() {
  const d = now()
  const open = looksOpen()
  const hours = S.data?.hours || S.session?.hours || [6, 22]
  $('clock-time').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  $('clock-note').textContent = (open ? `Otevřeno do ${pad(hours[1])}:00` : `Zavřeno do ${pad(hours[0])}:00`) + (previewShift ? ' · náhled' : '')
  $('clock').classList.toggle('closed', !open)
  document.body.classList.toggle('closed', !open)
}

function syncScene(agents) {
  const status = new Map()
  if (S.data) for (const a of agents) status.set(a.id, agentState(a.id))
  const c = S.data ? counts() : null
  scene.sync(agents, status, {
    open: looksOpen(),
    preview: previewShift ? now() : null,
    board: c ? ['Kancelář dnes', `Běží: ${c.running}`, `Čeká: ${c.waiting}`, `Ke schválení: ${c.review}`, `Hotovo: ${c.done}`] : ['Kancelář', 'Přihlas se'],
  })
}

let lastCover = ''
let lastChosen = null
function draw() {
  drawClock()
  const session = S.session
  $('login').hidden = Boolean(session?.authed)
  document.body.classList.toggle('guest', !session?.authed)
  if (!session?.authed || !S.data) return

  syncScene(S.data.agents)
  drawNav()
  drawRail()
  renderPanel($('panel'))
  renderSheet($('sheet'))
  refreshChat()

  const mode = $('mode')
  const ai = S.data.ai
  mode.className = `mode ${ai.provider === 'anthropic' ? 'live' : 'warn'}`
  mode.textContent = ai.provider === 'anthropic' ? 'AI připojena' : ai.provider === 'dev' ? 'Vývojový režim' : 'AI není nastavená'
  mode.title = ai.provider === 'anthropic' ? 'Úkoly zpracovává Claude přes Anthropic API.' : 'Otevři Nastavení.'

  const panelOpen = !$('panel').hidden
  document.body.classList.toggle('panel-open', panelOpen)
  document.body.classList.toggle('sheet-open', Boolean(S.sheet))
  const chosen = S.panel?.type === 'agent' ? S.panel.id : null
  if (chosen !== lastChosen) scene.select((lastChosen = chosen))
  const cover = isPhone() ? [0, 0, panelOpen ? Math.round(innerHeight * 0.6) : 0] : [document.body.classList.contains('rail-closed') ? 76 : 250, panelOpen ? Math.min(470, innerWidth) : 0, 0]
  if (cover.join() !== lastCover) {
    lastCover = cover.join()
    scene.cover(...cover)
  }
}

onChange(draw)
addEventListener('resize', () => {
  lastCover = ''
  if (S.data) draw()
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.target.matches('input, textarea, select')) return
  if (S.panel) closePanel()
  else if (S.sheet) openSheet(S.sheet)
})
$('rail-toggle').addEventListener('click', () => {
  document.body.classList.toggle('rail-closed')
  lastCover = ''
  draw()
})
$('zoom-in').addEventListener('click', () => scene.zoom(1.25))
$('zoom-out').addEventListener('click', () => scene.zoom(0.8))
$('zoom-fit').addEventListener('click', () => {
  if (S.panel?.type === 'agent') closePanel()
  scene.overview()
})

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const password = $('login-password')
  try {
    await api('POST', '/api/login', { password: password.value })
    password.value = ''
    await start()
  } catch (err) {
    $('login-note').textContent = err.message
  }
})

async function start() {
  try {
    S.session = await api('GET', '/api/session')
  } catch {
    $('login-note').textContent = 'Server kanceláře neodpovídá. Spusť ji příkazem node office.mjs.'
    $('login').hidden = false
    $('login-form').hidden = true
    return
  }
  if (S.session.authed) {
    await load()
    if (!S.data) toast('Nepodařilo se načíst kancelář.')
    return
  }
  // Not signed in: show the office with everyone at their desks, and the door.
  $('login-form').hidden = S.session.locked
  $('login-note').textContent = S.session.locked ? 'Kancelář je zatím jen k nahlédnutí: na serveru není nastavené heslo ADMIN_PASSWORD.' : ''
  try {
    const office = await api('GET', '/api/office')
    syncScene(office.agents)
  } catch {}
  changed()
}

setInterval(drawClock, 1000)
setInterval(() => document.visibilityState === 'visible' && load(), 2500)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load())
start()
