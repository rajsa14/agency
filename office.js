// The office: one floor per department, one desk per agent. Click a desk to read or change what the agent does.
;(() => {
  const HUES = [164, 258, 336, 204, 24, 78]
  const HAIR = ['spikes', 'tuft', 'parting', 'curl', 'bald']
  const PROPS = ['clipboard', 'hardhat', 'pencil', 'check', 'magnifier', 'envelope', 'megaphone', 'none']

  let agents = window.AGENCY || []
  let live = false
  let openFile = null
  let editing = false
  let notice = null

  const building = document.getElementById('building')
  const panel = document.getElementById('panel')
  const scrim = document.getElementById('scrim')
  const mode = document.getElementById('mode')

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(props)) {
      if (k === 'html') node.innerHTML = v
      else if (k === 'text') node.textContent = v
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v)
    }
    node.append(...kids.filter(Boolean))
    return node
  }

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')

  // Enough markdown for agent instructions: headings, lists, bold, code. Tables stay as plain text.
  function markdown(src) {
    const out = []
    let list = null
    let table = []
    const close = () => {
      if (list) out.push(`</${list}>`)
      if (table.length) out.push(`<pre>${esc(table.join('\n'))}</pre>`)
      list = null
      table = []
    }
    const item = (kind, text) => {
      if (list !== kind) {
        close()
        out.push(`<${kind}>`)
        list = kind
      }
      out.push(`<li>${inline(text)}</li>`)
    }
    const lines = src.split('\n')
    if (/^#\s/.test(lines[0] || '')) lines.shift()
    for (const line of lines) {
      let m
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
        close()
        const level = m[1].length > 2 ? 5 : 4
        out.push(`<h${level}>${inline(m[2])}</h${level}>`)
      } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) item('ul', m[1])
      else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) item('ol', m[1])
      else if (/^\|/.test(line)) {
        if (list) close()
        table.push(line)
      } else if (!line.trim()) close()
      else {
        close()
        out.push(`<p>${inline(line)}</p>`)
      }
    }
    close()
    return out.join('')
  }

  function departments() {
    const byName = new Map()
    for (const a of agents) {
      if (!byName.has(a.department)) byName.set(a.department, { name: a.department, floor: a.floor, staff: [] })
      const d = byName.get(a.department)
      d.staff.push(a)
      d.floor = Math.max(d.floor, a.floor)
    }
    const list = [...byName.values()].sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name))
    let tint = 0
    list.forEach((d, i) => {
      d.number = i + 1
      d.boss = d.staff.some((a) => a.avatar === 'claude')
      d.tint = d.boss ? -1 : tint++
      d.hue = d.boss ? 22 : HUES[d.tint % HUES.length]
    })
    return list.reverse()
  }

  const find = (file) => agents.find((a) => a.file === file)
  const deptOf = (agent) => departments().find((d) => d.name === agent.department)

  const CLOCK = `<svg viewBox="0 0 40 40" class="clock" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#f1eee8"/><circle cx="20" cy="20" r="18" fill="none" stroke="#0c0d13" stroke-width="3"/><path class="hour" d="M20 20V11" stroke="#1b1a1f" stroke-width="3" stroke-linecap="round"/><path class="minute" d="M20 20V7" stroke="#1b1a1f" stroke-width="2" stroke-linecap="round"/><circle cx="20" cy="20" r="2" fill="#d97757"/></svg>`
  const plant = (cls = '') =>
    `<svg viewBox="0 0 58 84" class="plant ${cls}" aria-hidden="true"><path d="M29 56C20 40 8 38 5 24c12 0 21 9 24 24C28 30 31 14 42 4c6 14 1 32-11 46 5-11 13-17 23-17-1 12-10 20-25 23z" fill="#3fae7c"/><path d="M29 56C24 42 14 36 5 24M30 52C31 34 36 18 42 4M31 54c6-9 13-15 23-21" fill="none" stroke="#2b8a60" stroke-width="1.5"/><path d="M15 56h28l-4 26H19z" fill="#d9825b"/><rect x="13" y="53" width="32" height="7" rx="2" fill="#e89a73"/></svg>`

  function desk(agent, dept, i) {
    const boss = agent.avatar === 'claude'
    return el(
      'button',
      {
        type: 'button',
        class: boss ? 'desk boss' : 'desk',
        style: `--c:${/^#[0-9a-f]{6}$/i.test(agent.color) ? agent.color : '#4f6bff'};--i:${i}`,
        'data-file': agent.file,
        'aria-haspopup': 'dialog',
        'aria-expanded': String(agent.file === openFile),
        'aria-label': `${agent.job}, ${dept.name}`,
        onclick: () => show(agent.file),
      },
      el('span', { class: 'lamp' }),
      el('span', { class: 'sitter', html: window.avatarSVG(agent, dept.tint) }),
      el('span', { class: 'laptop' }),
      el('span', { class: 'mug' }),
      el('span', { class: 'slab' }),
      el('span', { class: 'front' }, el('span', { class: 'plate', text: agent.job })),
    )
  }

  function renderBuilding() {
    const floors = departments().map((dept) =>
      el(
        'section',
        { class: 'floor', style: `--hue:${dept.hue}`, 'aria-label': dept.name },
        el('h2', { class: 'floor-sign' }, el('span', { class: 'num', text: String(dept.number).padStart(2, '0') }), el('span', { class: 'dept', text: dept.name })),
        el('div', { class: 'room', html: CLOCK + plant() }, el('div', { class: 'desks' }, ...dept.staff.map((a, i) => desk(a, dept, i + dept.number)))),
      ),
    )
    const lobby = el(
      'section',
      { class: 'floor lobby', style: '--hue:38', 'aria-label': 'Lobby' },
      el('h2', { class: 'floor-sign' }, el('span', { class: 'num', text: '00' }), el('span', { class: 'dept', text: 'Lobby' })),
      el('div', { class: 'room', html: plant('left') + plant() + '<div class="door"><i></i><i></i></div>' }),
    )
    building.replaceChildren(...floors, lobby)
    tick()
    mode.className = live ? 'mode live' : 'mode'
    mode.textContent = live ? 'Editing on' : 'View only · run node office.mjs to edit'
  }

  function tick() {
    const now = new Date()
    const minutes = now.getMinutes() * 6
    const hours = (now.getHours() % 12) * 30 + now.getMinutes() / 2
    for (const c of document.querySelectorAll('.clock')) {
      c.querySelector('.minute').setAttribute('transform', `rotate(${minutes} 20 20)`)
      c.querySelector('.hour').setAttribute('transform', `rotate(${hours} 20 20)`)
    }
  }

  // ---------- panel ----------
  function head(agent, dept) {
    return [
      el('button', { type: 'button', class: 'x', 'aria-label': 'Close', text: '×', onclick: hide }),
      el(
        'div',
        { class: 'who' },
        el('div', { class: 'face', html: window.avatarSVG(agent, dept.tint) }),
        el('div', {}, el('h2', { id: 'panel-title', text: agent.job }), el('p', { text: `${agent.name} · ${dept.name}` })),
      ),
    ]
  }

  function view(agent, dept) {
    const tools = agent.tools ? agent.tools.split(',').map((t) => t.trim()) : ['All tools']
    return [
      ...head(agent, dept),
      el(
        'div',
        { class: 'actions' },
        live && el('button', { type: 'button', class: 'btn primary', text: 'Change function', onclick: () => ((editing = true), (notice = null), renderPanel()) }),
        el('p', { class: notice ? `note ${notice.kind}` : 'note', text: notice ? notice.text : `agents/${agent.file}` }),
      ),
      el('h3', { text: 'Use when' }),
      el('p', { class: 'lead', text: agent.description }),
      el('h3', { text: 'Tools' }),
      el('ul', { class: 'chips' }, ...tools.map((t) => el('li', { text: t }))),
      el('h3', { text: 'Function' }),
      el('div', { class: 'prose', html: markdown(agent.body) }),
    ]
  }

  function field(label, control) {
    return el('label', {}, label, control)
  }
  function select(name, options, value) {
    return el('select', { name }, ...options.map((o) => el('option', { value: o, selected: String(o) === String(value), text: String(o) })))
  }

  function form(agent, dept) {
    const names = [...new Set(agents.map((a) => a.department))]
    const body = el('textarea', { name: 'body', required: true, spellcheck: 'false' })
    body.value = agent.body
    const description = el('textarea', { name: 'description', required: true, maxlength: 1000 })
    description.value = agent.description
    const status = el('p', { class: 'note' })
    const submit = el('button', { type: 'submit', class: 'btn primary', text: 'Save' })

    const f = el(
      'form',
      {
        onsubmit: async (e) => {
          e.preventDefault()
          submit.disabled = true
          status.className = 'note'
          status.textContent = 'Saving…'
          try {
            const r = await fetch(`api/agents/${agent.file}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(Object.fromEntries(new FormData(f))),
            })
            const out = await r.json()
            if (!r.ok) throw new Error(out.error || 'Could not save')
            agents = out
            editing = false
            notice = { kind: 'ok', text: `Saved to agents/${agent.file} and installed in Claude Code` }
            renderBuilding()
            renderPanel()
          } catch (err) {
            submit.disabled = false
            status.className = 'note bad'
            status.textContent = err.message
          }
        },
      },
      field('Desk label', el('input', { name: 'job', value: agent.job, required: true, maxlength: 60 })),
      field('Department', el('input', { name: 'department', value: agent.department, required: true, maxlength: 60, list: 'departments' })),
      el('datalist', { id: 'departments' }, ...names.map((n) => el('option', { value: n }))),
      agent.avatar === 'helper' &&
        el('div', { class: 'trio' }, field('Eyes', select('eyes', [1, 2], agent.eyes)), field('Hair', select('hair', HAIR, agent.hair)), field('Holding', select('prop', PROPS, agent.prop))),
      field('Use when', description),
      field('Function', body),
      el('div', { class: 'actions' }, submit, el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => ((editing = false), renderPanel()) }), status),
    )
    return [...head(agent, dept), f]
  }

  function renderPanel() {
    const agent = find(openFile)
    if (!agent) return hide()
    const dept = deptOf(agent)
    panel.style.setProperty('--hue', dept.hue)
    panel.replaceChildren(...(editing ? form(agent, dept) : view(agent, dept)))
    panel.scrollTop = 0
  }

  function show(file) {
    openFile = file
    editing = false
    notice = null
    panel.hidden = scrim.hidden = false
    renderPanel()
    for (const d of document.querySelectorAll('.desk')) d.setAttribute('aria-expanded', String(d.dataset.file === file))
    panel.querySelector('.x').focus()
  }

  function hide() {
    if (editing && !confirm('Discard your changes?')) return
    const from = openFile
    openFile = null
    editing = false
    panel.hidden = scrim.hidden = true
    for (const d of document.querySelectorAll('.desk')) d.setAttribute('aria-expanded', 'false')
    document.querySelector(`.desk[data-file="${from}"]`)?.focus()
  }

  scrim.addEventListener('click', hide)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openFile) hide()
  })

  // Everyone keeps an eye on the pointer.
  let frame = 0
  document.addEventListener('pointermove', (e) => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      for (const a of document.querySelectorAll('.avatar')) {
        const r = a.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 3)
        const d = Math.hypot(dx, dy) || 1
        const reach = Math.min(1, d / 160) * 3.2
        a.style.setProperty('--lx', ((dx / d) * reach).toFixed(2))
        a.style.setProperty('--ly', ((dy / d) * reach).toFixed(2))
      }
    })
  })

  setInterval(tick, 30_000)
  renderBuilding()
  // With office.mjs running the page reads the agent files directly and can save changes back.
  if (location.protocol.startsWith('http')) {
    fetch('api/agents')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list) => {
        agents = list
        live = true
        renderBuilding()
      })
      .catch(() => {})
  }
})()
