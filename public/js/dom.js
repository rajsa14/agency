// Small shared helpers for the interface: element builder, markdown, labels, dates.

export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'html') node.innerHTML = v
    else if (k === 'text') node.textContent = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v)
  }
  node.append(...kids.flat().filter((kid) => kid !== false && kid != null))
  return node
}

// replaceChildren that, like el(), skips the false / null left behind by `condition && node`.
export const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((kid) => kid !== false && kid != null && kid !== ''))

export const STATUS = {
  queued: 'Ve frontě',
  paused: 'Pozastaveno',
  thinking: 'Přemýšlí',
  working: 'Pracuje',
  needs_approval: 'Ke schválení',
  completed: 'Hotovo',
  error: 'Chyba',
  cancelled: 'Zrušeno',
}
export const AGENT_STATE = { idle: 'Volno', working: 'Pracuje', thinking: 'Přemýšlí', waiting: 'Čeká', needs_approval: 'Ke schválení', completed: 'Dokončil', error: 'Chyba' }
export const PRIORITY = { low: 'Nízká', normal: 'Běžná', high: 'Vysoká', urgent: 'Urgentní' }
export const IDLE = [['auto', 'Podle sebe'], ['desk', 'U stolu'], ['coffee', 'Káva'], ['walk', 'Procházka'], ['chat', 'Pokec'], ['dance', 'Tanec']]
export const HAIR = ['spikes', 'tuft', 'parting', 'curl', 'bald']
export const PROPS = ['clipboard', 'hardhat', 'pencil', 'check', 'magnifier', 'envelope', 'megaphone', 'none']

export const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

// Enough markdown for instructions and results: headings, lists, quotes, bold, code, links. Tables stay as plain text.
export function markdown(src) {
  const out = []
  let list = null
  let block = []
  let fence = null
  const close = () => {
    if (list) out.push(`</${list}>`)
    if (block.length) out.push(`<pre>${esc(block.join('\n'))}</pre>`)
    list = null
    block = []
  }
  const item = (kind, text) => {
    if (list !== kind) {
      close()
      out.push(`<${kind}>`)
      list = kind
    }
    out.push(`<li>${inline(text)}</li>`)
  }
  for (const line of String(src || '').split('\n')) {
    let m
    if (fence !== null) {
      if (/^```/.test(line)) {
        out.push(`<pre>${esc(fence.join('\n'))}</pre>`)
        fence = null
      } else fence.push(line)
    } else if (/^```/.test(line)) {
      close()
      fence = []
    } else if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      close()
      const level = Math.min(m[1].length + 3, 6)
      out.push(`<h${level}>${inline(m[2])}</h${level}>`)
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) item('ul', m[1])
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) item('ol', m[1])
    else if ((m = line.match(/^>\s?(.*)/))) {
      close()
      out.push(`<blockquote>${inline(m[1])}</blockquote>`)
    } else if (/^\|/.test(line)) {
      if (list) close()
      block.push(line)
    } else if (!line.trim()) close()
    else {
      close()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  if (fence !== null) out.push(`<pre>${esc(fence.join('\n'))}</pre>`)
  close()
  return out.join('')
}

const two = (n) => String(n).padStart(2, '0')
export function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`
  return d.toDateString() === today.toDateString() ? time : `${d.getDate()}. ${d.getMonth() + 1}. ${time}`
}
export const untilDue = (iso) => {
  if (!iso) return ''
  const days = Math.round((new Date(iso) - Date.now()) / 86_400_000)
  const d = new Date(iso)
  const date = `${d.getDate()}. ${d.getMonth() + 1}.`
  return days < 0 ? `${date} (po termínu)` : days === 0 ? `${date} (dnes)` : date
}
export const localInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`
}
export function duration(from, to) {
  if (!from || !to) return ''
  const s = Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export const pill = (status) => el('span', { class: `pill s-${status}`, text: STATUS[status] || status })

export function toast(message, kind = 'bad') {
  const node = el('p', { class: `toast ${kind}`, role: 'status', text: message })
  document.getElementById('toasts').append(node)
  setTimeout(() => node.remove(), 6000)
}

export const field = (label, control, hint) => el('label', { class: 'field' }, el('span', { text: label }), control, hint && el('small', { text: hint }))
export const select = (name, options, value) => el('select', { name }, ...options.map(([v, text]) => el('option', { value: v, selected: String(v) === String(value), text })))
