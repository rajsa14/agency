// The office in 3D: one floor per department, one desk per agent.
// Click someone to see what they do, change what they are doing right now, or give them a task.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { makeCharacter } from './characters.js'

const W = 14
const D = 6.4
const H = 3.5
const SLAB = 0.3
const SPEED = 1.7
const HUES = [164, 258, 336, 204, 24, 78]
const BODIES = ['#8fe3c3', '#c8b6ff', '#ffadc9', '#8fd3ff', '#ffc59e', '#d3ec8c']
const HAIR = ['spikes', 'tuft', 'parting', 'curl', 'bald']
const PROPS = ['clipboard', 'hardhat', 'pencil', 'check', 'magnifier', 'envelope', 'megaphone', 'none']
const ACTIVITIES = [['auto', 'Own choice'], ['desk', 'At the desk'], ['coffee', 'Coffee'], ['walk', 'Walk'], ['chat', 'Chat'], ['dance', 'Dance']]
const STATUS = { queued: 'Queued', running: 'Working', done: 'Done', failed: 'Failed' }

// ---------- time: nobody works between 22:00 and 06:00 ----------
// ?time=23:30 previews another hour; the task queue itself always follows the real clock.
const preview = new URLSearchParams(location.search).get('time')
const shift = (() => {
  const m = preview && preview.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  const d = new Date()
  d.setHours(+m[1], +m[2], 0, 0)
  return d - Date.now()
})()
const now = () => new Date(Date.now() + shift)
const isOpen = (d = now()) => d.getHours() >= 6 && d.getHours() < 22
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const daylight = (d) => {
  const h = d.getHours() + d.getMinutes() / 60
  return Math.min(smooth(5, 8, h), 1 - smooth(18.5, 21.5, h))
}

// ---------- state ----------
let agents = window.AGENCY || []
let live = false
let shared = { activities: {}, tasks: [] }
let openFile = null
let editing = false
let notice = null
const results = new Map()

const $ = (id) => document.getElementById(id)
const canvas = $('scene')
const panel = $('panel')
const bubbles = $('bubbles')

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

const rand = (a, b) => a + Math.random() * (b - a)
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')

// Enough markdown for agent instructions and results: headings, lists, bold, code. Tables stay as plain text.
function markdown(src, keepTitle = false) {
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
  if (!keepTitle && /^#\s/.test(lines[0] || '')) lines.shift()
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
    d.tint = d.boss ? 0 : tint++
    d.hue = d.boss ? 22 : HUES[d.tint % HUES.length]
  })
  return list
}

const find = (file) => agents.find((a) => a.file === file)
const taskOf = (file) => shared.tasks.find((t) => t.agent === file && t.status === 'running') || shared.tasks.find((t) => t.agent === file && t.status === 'queued')

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
const scene = new THREE.Scene()
const sky = new THREE.Color()
scene.background = sky
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.minPolarAngle = 0.95
controls.maxPolarAngle = 1.6
controls.minAzimuthAngle = -0.95
controls.maxAzimuthAngle = 0.95
controls.minDistance = 7
controls.zoomSpeed = 0.7

const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2a2233, 1)
const sun = new THREE.DirectionalLight(0xffffff, 1)
sun.position.set(8, 14, 22)
scene.add(hemi, sun)

const NIGHT = new THREE.Color(0x070818)
const DAY = new THREE.Color(0x86bdf5)
const DUSK = new THREE.Color(0xf08a5d)
const skyMat = new THREE.MeshBasicMaterial({ color: 0x070818, fog: false })
const groundMat = new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 1 })
const GROUND_NIGHT = new THREE.Color(0x0b0c12)
const GROUND_DAY = new THREE.Color(0x6f8f6a)
scene.fog = new THREE.Fog(0x070818, 90, 330)

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra })
const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l)
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material.isMaterial ? material : std(material))
  m.position.set(x, y, z)
  return m
}
function plane(w, h, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material)
  m.position.set(x, y, z)
  return m
}

function textTexture(text, { width = 512, height = 128, bg = null, color = '#1b1a1f', font = 'ui-monospace, "Cascadia Code", Consolas, monospace', weight = 700, size = 56, spacing = 3, glow = null } = {}) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const g = c.getContext('2d')
  if (bg) {
    const grad = g.createLinearGradient(0, 0, 0, height)
    grad.addColorStop(0, bg[0])
    grad.addColorStop(1, bg[1])
    g.fillStyle = grad
    g.fillRect(0, 0, width, height)
  }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = color
  if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`
  const fit = (s, px) => {
    g.font = `${weight} ${px}px ${font}`
    return g.measureText(s).width <= width - 44
  }
  let lines = [text]
  let px = size
  while (px > 30 && !fit(text, px)) px -= 2
  if (!fit(text, px) && text.includes(' ')) {
    const words = text.split(' ')
    let best = [text]
    let bestWidth = Infinity
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
      g.font = `${weight} 40px ${font}`
      const w = Math.max(...pair.map((s) => g.measureText(s).width))
      if (w < bestWidth) [best, bestWidth] = [pair, w]
    }
    lines = best
    px = 40
    while (px > 20 && !lines.every((s) => fit(s, px))) px -= 2
  }
  g.font = `${weight} ${px}px ${font}`
  if (glow) {
    g.shadowColor = glow
    g.shadowBlur = 34
  }
  lines.forEach((s, i) => g.fillText(s, width / 2, height / 2 + (i - (lines.length - 1) / 2) * px * 1.12))
  if (glow) lines.forEach((s, i) => g.fillText(s, width / 2, height / 2 + (i - (lines.length - 1) / 2) * px * 1.12))
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

let world = null
let staff = []
let lamps = []
let pickables = []
let floors = []
let total = H
let stars = null
let moon = null
let beacon = null

function plant(scale = 1) {
  const g = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.36, 14), std(0xd9825b))
  pot.position.y = 0.18
  g.add(pot)
  const leaf = std(0x3fae7c)
  for (let i = 0; i < 7; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), leaf)
    const a = i * 0.9
    l.scale.set(0.45, 1.9, 0.2)
    l.position.set(Math.cos(a) * 0.12, 0.62 + (i % 3) * 0.08, Math.sin(a) * 0.12)
    l.rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.5)
    g.add(l)
  }
  g.scale.setScalar(scale)
  return g
}

function addFloor(y, hue, title, number) {
  const g = new THREE.Group()
  g.position.y = y
  const wall = std(hsl(hue, 0.34, 0.3))
  const side = std(hsl(hue, 0.3, 0.24))
  const tall = H - SLAB
  g.add(box(W + 0.7, SLAB, D + 0.7, 0x15161d, 0, -SLAB / 2, 0))
  const carpet = plane(W, D, std(hsl(hue, 0.28, 0.17)), 0, 0.004, 0)
  carpet.rotation.x = -Math.PI / 2
  const left = plane(D, tall, side, -W / 2, tall / 2, 0)
  left.rotation.y = Math.PI / 2
  const right = plane(D, tall, side, W / 2, tall / 2, 0)
  right.rotation.y = -Math.PI / 2
  g.add(carpet, plane(W, tall, wall, 0, tall / 2, -D / 2), left, right)
  g.add(box(W, 0.12, 0.05, hsl(hue, 0.3, 0.18), 0, 0.06, -D / 2 + 0.03))
  for (const x of [-4.5, 0, 4.5]) {
    g.add(box(2.3, 1.2, 0.06, 0x0c0d13, x, 1.75, -D / 2 + 0.03))
    g.add(plane(2.1, 1.0, skyMat, x, 1.75, -D / 2 + 0.065))
    g.add(box(0.05, 1.0, 0.02, 0x0c0d13, x, 1.75, -D / 2 + 0.07))
  }
  const label = `${String(number).padStart(2, '0')}  ${title.toUpperCase()}`
  const tex = textTexture(label, { width: 1024, height: 128, color: `hsl(${hue} 100% 93%)`, size: 84, spacing: 8, weight: 800 })
  const sign = plane(5.6, 0.7, new THREE.MeshBasicMaterial({ map: tex, transparent: true }), -W / 2 + 3.1, tall - 0.5, -D / 2 + 0.02)
  g.add(sign)
  world.add(g)
  return g
}

function addDesk(g, x, agent, boss) {
  const desk = new THREE.Group()
  desk.position.set(x, 0, -0.4)
  const s = boss ? 1.2 : 1
  const wood = std(boss ? 0x4a3930 : 0xc69a6c)
  const dark = std(boss ? 0x2a2220 : 0x8a6341)
  desk.add(box(1.9 * s, 0.07, 0.85, wood, 0, 0.6, 0))
  desk.add(box(1.7 * s, 0.57, 0.05, dark, 0, 0.285, 0.36))
  desk.add(box(0.06, 0.57, 0.72, dark, -0.85 * s, 0.285, 0), box(0.06, 0.57, 0.72, dark, 0.85 * s, 0.285, 0))
  const plateTex = textTexture(agent.job.toUpperCase(), { bg: boss ? ['#ffdcae', '#eaa565'] : ['#fff7df', '#ecd9a8'], size: boss ? 64 : 50, spacing: boss ? 12 : 3 })
  const cream = std(boss ? 0xeaa565 : 0xecd9a8)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.38, 0.03), [cream, cream, cream, cream, new THREE.MeshBasicMaterial({ map: plateTex }), cream])
  plate.position.set(0, 0.29, 0.4)
  desk.add(plate)

  const color = /^#[0-9a-f]{6}$/i.test(agent.color) ? agent.color : '#4f6bff'
  const laptop = new THREE.Group()
  laptop.position.set(-0.52, 0.64, -0.12)
  laptop.rotation.y = 0.35
  laptop.add(box(0.5, 0.02, 0.34, 0x343645, 0, 0, 0))
  const lid = new THREE.Group()
  lid.position.set(0, 0.01, 0.17)
  lid.rotation.x = 0.28
  lid.add(box(0.5, 0.34, 0.02, 0x2a2c38, 0, 0.17, 0))
  const glow = new THREE.MeshBasicMaterial({ color })
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), glow)
  dot.position.set(0, 0.17, 0.012)
  const screen = new THREE.MeshBasicMaterial({ color: 0xdfeaff })
  const face = plane(0.46, 0.3, screen, 0, 0.17, -0.012)
  face.rotation.y = Math.PI
  lid.add(dot, face)
  laptop.add(lid)
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.1, 14), std(0xf1eee8))
  cup.position.set(0.68 * s, 0.685, 0.12)
  desk.add(laptop, cup)

  const tall = H - SLAB
  const cord = box(0.02, 0.5, 0.02, 0x07070b, x, tall - 0.25, -0.5)
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.24, 20, 1, true), std(0x0b0b11, { side: THREE.DoubleSide }))
  shade.position.set(x, tall - 0.6, -0.5)
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }))
  bulb.rotation.x = Math.PI / 2
  bulb.position.set(x, tall - 0.71, -0.5)
  const light = new THREE.PointLight(0xffd9a0, 0, 7.5, 1.4)
  light.position.set(x, tall - 0.95, 0.1)
  g.add(desk, cord, shade, bulb, light)
  lamps.push({ light, bulb, screen, glow, color: new THREE.Color(color), file: agent.file })
  desk.userData.file = agent.file
  pickables.push(desk)
}

function buildWorld() {
  if (world) {
    scene.remove(world)
    world.traverse((o) => {
      o.geometry?.dispose()
      for (const m of [].concat(o.material || [])) {
        if (m === skyMat || m === groundMat) continue
        m.map?.dispose()
        m.dispose()
      }
    })
    bubbles.replaceChildren()
  }
  world = new THREE.Group()
  staff = []
  lamps = []
  pickables = []
  floors = []
  const depts = departments()
  total = (depts.length + 1) * H

  // lobby
  const lobby = addFloor(0, 38, 'Lobby', 0)
  lobby.add(box(2.5, 2.5, 0.08, 0x0c0d13, 0, 1.25, -D / 2 + 0.05))
  for (const x of [-0.6, 0.6]) lobby.add(plane(1.1, 2.3, new THREE.MeshBasicMaterial({ color: 0xffe0aa }), x, 1.18, -D / 2 + 0.1))
  const rug = plane(4.6, 2.2, std(0x7a3f2e), 0, 0.008, 0.6)
  rug.rotation.x = -Math.PI / 2
  const p1 = plant(1.5)
  p1.position.set(-2.2, 0, -D / 2 + 0.7)
  const p2 = plant(1.5)
  p2.position.set(2.2, 0, -D / 2 + 0.7)
  const lobbyLight = new THREE.PointLight(0xffd9a0, 0, 10, 1.4)
  lobbyLight.position.set(0, 2.6, 0.5)
  lobby.add(rug, p1, p2, lobbyLight)
  lamps.push({ light: lobbyLight })

  for (const dept of depts) {
    const y = dept.number * H
    const g = addFloor(y, dept.hue, dept.name, dept.number)
    const xs = dept.staff.map((_, i) => (i - (dept.staff.length - 1) / 2) * 2.9)
    const aisles = [...new Set(xs.flatMap((x) => [x - 1.45, x + 1.45]).concat([-(W / 2 - 1), W / 2 - 1]))]
    const floor = { group: g, y, aisles, dept }
    floors.push(floor)

    const green = plant(1.3)
    green.position.set(-W / 2 + 0.8, 0, -D / 2 + 0.7)
    g.add(green)
    g.add(box(1.5, 0.75, 0.6, hsl(dept.hue, 0.2, 0.12), W / 2 - 1.05, 0.375, -D / 2 + 0.4))
    g.add(box(0.5, 0.6, 0.42, 0x23242e, W / 2 - 1.3, 1.05, -D / 2 + 0.38))
    g.add(box(0.34, 0.06, 0.2, 0xd97757, W / 2 - 1.3, 1.2, -D / 2 + 0.6))
    for (const dx of [0.35, 0.52]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.1, 12), std(0xf1eee8))
      c.position.set(W / 2 - 1.3 + dx + 0.3, 0.8, -D / 2 + 0.45)
      g.add(c)
    }

    dept.staff.forEach((agent, i) => {
      const boss = agent.avatar === 'claude'
      addDesk(g, xs[i], agent, boss)
      const char = makeCharacter(agent, BODIES[dept.tint % BODIES.length])
      char.group.userData.file = agent.file
      g.add(char.group)
      pickables.push(char.group)
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }))
      shadow.rotation.x = -Math.PI / 2
      shadow.position.y = 0.012
      char.group.add(shadow)
      const home = { x: xs[i], z: -1.17 }
      const bubble = el('div', { class: 'bubble' })
      bubbles.append(bubble)
      staff.push({
        agent, file: agent.file, floor, char, home, bubble,
        pos: { ...home }, face: 0, heading: 0, path: [], mode: 'desk', wait: 0,
        lane: 1 + (staff.length % 4) * 0.42, seed: Math.random() * 10,
        auto: { mode: 'desk', until: rand(5, 30) }, hop: 0, cheer: 0, hover: false, said: '',
      })
    })
  }

  // roof, sign, antenna
  world.add(box(W + 0.7, SLAB, D + 0.7, 0x15161d, 0, total - SLAB / 2, 0))
  const signTex = textTexture('AGENCY', { width: 1024, height: 256, color: '#fff1e4', font: '"Segoe UI", system-ui, sans-serif', weight: 800, size: 150, spacing: 46, glow: '#ff7a45' })
  world.add(plane(9, 2.25, new THREE.MeshBasicMaterial({ map: signTex, transparent: true, depthWrite: false }), 0, total + 1.5, 0))
  world.add(box(0.08, 0.7, 0.08, 0x2b2c38, -2.6, total + 0.35, 0), box(0.08, 0.7, 0.08, 0x2b2c38, 2.6, total + 0.35, 0))
  world.add(box(0.06, 2.2, 0.06, 0x2b2c38, W / 2 - 1, total + 1.1, -1))
  beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff4d4d }))
  beacon.position.set(W / 2 - 1, total + 2.3, -1)
  world.add(beacon)
  // back and outside
  world.add(plane(W + 0.7, total, std(0x191a23), 0, total / 2, -D / 2 - 0.36))
  const ground = plane(900, 900, groundMat, 0, -SLAB, 0)
  ground.rotation.x = -Math.PI / 2
  world.add(ground)

  if (!stars) {
    const pts = []
    for (let i = 0; i < 500; i++) pts.push(rand(-220, 220), rand(2, 150), rand(-200, -120))
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false }))
    moon = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 18), new THREE.MeshBasicMaterial({ color: 0xfdf3d8, fog: false }))
    scene.add(stars, moon)
  }
  moon.position.set(46, total + 22, -150)

  scene.add(world)
  aim()
  dock()
}

// ---------- behaviour ----------
function route(a, to) {
  const from = a.pos
  if (Math.hypot(from.x - to.x, from.z - to.z) < 0.05) return []
  const nearest = (x) => a.floor.aisles.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best))
  const fa = from.z < 0.6 ? nearest(from.x) : null
  const ta = to.z < 0.6 ? nearest(to.x) : null
  const pts = []
  if (fa !== null && fa === ta) pts.push({ x: fa, z: from.z }, { x: ta, z: to.z })
  else {
    if (fa !== null) pts.push({ x: fa, z: from.z }, { x: fa, z: a.lane })
    if (ta !== null) pts.push({ x: ta, z: a.lane }, { x: ta, z: to.z })
  }
  pts.push({ x: to.x, z: to.z })
  return pts
}

function go(a, mode) {
  a.mode = mode
  let to = a.home
  let face = 0
  if (mode === 'coffee') {
    to = { x: W / 2 - 1, z: -D / 2 + 1.25 }
    face = 0.3
  } else if (mode === 'walk') {
    to = { x: rand(-W / 2 + 1, W / 2 - 1), z: rand(1, 2.7) }
    face = rand(-0.6, 0.6)
  } else if (mode === 'dance') {
    to = { x: Math.max(-5, Math.min(5, a.home.x)), z: 1.5 + a.lane * 0.3 }
  } else if (mode === 'chat') {
    const mates = staff.filter((b) => b !== a && b.floor === a.floor)
    const mate = mates.sort((p, q) => Math.abs(p.home.x - a.home.x) - Math.abs(q.home.x - a.home.x))[0]
    if (mate) {
      const sideways = a.home.x > mate.home.x ? 1.3 : -1.3
      to = { x: mate.home.x + sideways, z: -0.95 }
      face = Math.atan2(mate.home.x - to.x, mate.home.z - to.z)
    } else to = { x: 0, z: 1.9 }
  } else if (mode === 'cheer') {
    a.path = []
    return
  }
  a.path = route(a, to)
  a.face2 = face
  if (!a.path.length) a.face = face
}

function step(a, t, dt, open) {
  if (a.cheer > 0) a.cheer -= dt
  if (a.hop > 0) a.hop -= dt
  const chosen = shared.activities[a.file] || 'auto'
  if (chosen === 'auto' && t > a.auto.until) {
    a.auto = a.auto.mode === 'desk' ? { mode: pick(['coffee', 'walk', 'chat', 'walk']), until: t + rand(9, 16) } : { mode: 'desk', until: t + rand(16, 44) }
  }
  const task = taskOf(a.file)
  const want = !open ? 'sleep' : task ? 'desk' : chosen === 'auto' ? a.auto.mode : chosen
  if (want !== a.mode) go(a, want)
  if (a.mode === 'walk' && !a.path.length && t > a.wait) go(a, 'walk')

  if (a.path.length) {
    const p = a.path[0]
    const dx = p.x - a.pos.x
    const dz = p.z - a.pos.z
    const dist = Math.hypot(dx, dz)
    const reach = SPEED * dt
    if (dist <= reach) {
      a.pos.x = p.x
      a.pos.z = p.z
      a.path.shift()
      if (!a.path.length) {
        a.face = a.face2
        a.wait = t + rand(1.2, 3.5)
      }
    } else {
      a.pos.x += (dx / dist) * reach
      a.pos.z += (dz / dist) * reach
      a.face = Math.atan2(dx, dz)
    }
  }

  // pose
  const c = a.char
  const moving = a.path.length > 0
  const s = a.seed
  let lx = 0, lz = 0, rx = 0, rz = 0, y = 0, pitch = 0, twist = 0, leg = 0
  let shut = false
  let coffee = false
  if (moving) {
    const w = Math.sin(t * 11 + s)
    lx = w * 0.7
    rx = -w * 0.7
    leg = w
    y = Math.abs(Math.cos(t * 11 + s)) * 0.05
  } else if (a.mode === 'desk') {
    const k = task && task.status === 'running' ? 24 : 8
    lx = -1.3 + Math.sin(t * k + s) * 0.11
    rx = c.prop ? -0.8 + Math.sin(t * 2 + s) * 0.07 : -1.3 + Math.sin(t * k + s + 2) * 0.11
    rz = c.prop ? 0.22 : 0
    y = Math.sin(t * 2 + s) * 0.012
    twist = -0.18
  } else if (a.mode === 'sleep') {
    pitch = 0.4
    shut = true
    y = Math.sin(t * 1.2 + s) * 0.014 - 0.02
    lx = rx = -0.95
  } else if (a.mode === 'coffee') {
    coffee = true
    const sip = Math.sin(t * 0.9 + s) > 0.5
    rx = sip ? -2.2 : -1.15
    rz = sip ? -0.3 : 0
    y = Math.sin(t * 1.6 + s) * 0.012
  } else if (a.mode === 'chat') {
    rx = -1 + Math.sin(t * 4 + s) * 0.5
    rz = 0.45 + Math.sin(t * 3 + s) * 0.2
    y = Math.abs(Math.sin(t * 3 + s)) * 0.035
  } else if (a.mode === 'dance') {
    y = Math.abs(Math.sin(t * 7 + s)) * 0.22
    lz = -2.4 + Math.sin(t * 7) * 0.45
    rz = 2.4 + Math.sin(t * 7 + 1) * 0.45
    twist = Math.sin(t * 3.5 + s) * 0.9
  } else {
    lx = Math.sin(t * 1.5 + s) * 0.08
    rx = -lx
    y = Math.sin(t * 2 + s) * 0.012
  }
  if (a.cheer > 0) {
    y += Math.abs(Math.sin(a.cheer * 8)) * 0.3
    lz = -2.6
    rz = 2.6
    lx = rx = 0
  }
  if (a.hover && !shut && !coffee) {
    rz = 2.5 + Math.sin(t * 12) * 0.3
    rx = 0
  }
  if (a.hop > 0) y += Math.sin((a.hop / 0.5) * Math.PI) * 0.35

  const k = 1 - Math.exp(-dt * 12)
  c.armL.rotation.x += (lx - c.armL.rotation.x) * k
  c.armL.rotation.z += (lz - c.armL.rotation.z) * k
  c.armR.rotation.x += (rx - c.armR.rotation.x) * k
  c.armR.rotation.z += (rz - c.armR.rotation.z) * k
  c.held.rotation.x = -c.armR.rotation.x
  c.held.rotation.z = -c.armR.rotation.z
  c.cup.visible = coffee && !moving
  if (c.prop) c.prop.visible = !c.cup.visible
  c.rig.position.y = y
  c.rig.rotation.x += (pitch - c.rig.rotation.x) * k
  c.rig.rotation.y += (twist - c.rig.rotation.y) * k
  c.legL.position.z = 0.03 + leg * 0.09
  c.legR.position.z = 0.03 - leg * 0.09
  c.legL.position.y = 0.06 + Math.max(0, leg) * 0.05
  c.legR.position.y = 0.06 + Math.max(0, -leg) * 0.05
  if (c.rays) c.rays.rotation.z += dt * (a.hover || a.mode === 'dance' ? 2.4 : a.mode === 'sleep' ? 0 : 0.25)
  c.shut(shut || (t + s * 3) % 4.3 < 0.12)

  let turn = a.face - a.heading
  turn = Math.atan2(Math.sin(turn), Math.cos(turn))
  a.heading += turn * (1 - Math.exp(-dt * 10))
  c.group.position.set(a.pos.x, 0, a.pos.z)
  c.group.rotation.y = a.heading
}

// ---------- camera ----------
const view = { goal: new THREE.Vector3(), dist: 40, auto: true }
const isPhone = () => innerWidth <= 760
const cover = () => (panel.hidden ? [0, 0] : isPhone() ? [0, size()[1] * 0.58] : [Math.min(480, size()[0]), 0])

// A pane that is not laid out yet reports a 0x0 window, so never size from zero.
const size = () => [innerWidth || 960, innerHeight || 600]

function fit(h, w) {
  const [cx, cy] = cover()
  const [iw, ih] = size()
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const vh = Math.max(200, ih - cy)
  const vw = Math.max(200, iw - cx)
  return Math.max(((h / 2 / tan) * ih) / vh, w / 2 / (tan * (vw / ih))) * 1.05
}

function aim() {
  const a = staff.find((x) => x.file === openFile)
  if (a) {
    view.goal.set(0, a.floor.y + 1.45, 0)
    view.dist = fit(H + 1.2, W + 1.5)
  } else {
    view.goal.set(0, total / 2 + 0.9, 0)
    view.dist = fit(total + 4.4, W + 2.5)
  }
  controls.maxDistance = fit(total + 4.4, W + 2.5) * 1.5
  view.auto = true
}

function resize() {
  const [iw, ih] = size()
  renderer.setSize(iw, ih, false)
  camera.aspect = iw / ih
  const [cx, cy] = cover()
  if (cx || cy) camera.setViewOffset(iw, ih, cx / 2, cy / 2, iw, ih)
  else camera.clearViewOffset()
  camera.updateProjectionMatrix()
}

controls.addEventListener('start', () => (view.auto = false))
addEventListener('resize', () => {
  resize()
  aim()
})

// ---------- pointer ----------
const ray = new THREE.Raycaster()
const pointer = new THREE.Vector2(0, 0)
let pointerSeen = false
let down = null

function pickAt(ev) {
  const r = canvas.getBoundingClientRect()
  ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera)
  let o = ray.intersectObjects(pickables, true)[0]?.object
  while (o && !o.userData.file) o = o.parent
  return o ? o.userData.file : null
}

canvas.addEventListener('pointermove', (ev) => {
  pointer.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1)
  pointerSeen = true
  if (ev.buttons) return
  const file = ev.pointerType === 'mouse' ? pickAt(ev) : null
  for (const a of staff) a.hover = a.file === file
  canvas.style.cursor = file ? 'pointer' : 'grab'
})
canvas.addEventListener('pointerleave', () => {
  for (const a of staff) a.hover = false
})
canvas.addEventListener('pointerdown', (ev) => (down = [ev.clientX, ev.clientY]))
canvas.addEventListener('pointerup', (ev) => {
  if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return
  const file = pickAt(ev)
  if (file) select(file)
  else if (openFile && !editing) hide()
})

// ---------- loop ----------
const timer = new THREE.Clock()
const head = new THREE.Vector3()

function frame() {
  const dt = Math.min(timer.getDelta(), 0.05)
  const t = timer.elapsedTime
  const date = now()
  const open = isOpen(date)
  const dl = daylight(date)

  sky.copy(NIGHT).lerp(DAY, dl).lerp(DUSK, Math.sin(Math.PI * dl) * 0.45)
  skyMat.color.copy(sky)
  scene.fog.color.copy(sky)
  groundMat.color.copy(GROUND_NIGHT).lerp(GROUND_DAY, dl)
  hemi.intensity = 0.3 + 1.5 * dl
  sun.intensity = 0.25 + 1.5 * dl
  stars.material.opacity = 1 - dl
  moon.visible = dl < 0.6
  beacon.material.color.setHex(t % 2.4 < 1.6 ? 0xff4d4d : 0x551111)
  for (const l of lamps) {
    l.light.intensity = open ? 9 : 0
    if (!l.bulb) continue
    l.bulb.material.color.setHex(open ? 0xffe2a8 : 0x1a1a22)
    const task = taskOf(l.file)
    const busy = open && task && task.status === 'running'
    l.screen.color.setHex(open ? 0xdfeaff : 0x10111a)
    l.glow.color.copy(l.color).multiplyScalar(open ? (busy ? 0.6 + Math.abs(Math.sin(t * 6)) * 0.9 : 1) : 0.15)
  }

  for (const a of staff) step(a, t, dt, open)

  if (view.auto) {
    const k = 1 - Math.exp(-dt * 5)
    const off = camera.position.clone().sub(controls.target)
    controls.target.lerp(view.goal, k)
    off.setLength(off.length() + (view.dist - off.length()) * k)
    camera.position.copy(controls.target).add(off)
  }
  controls.target.x = Math.max(-W / 2, Math.min(W / 2, controls.target.x))
  controls.target.y = Math.max(0, Math.min(total + 2, controls.target.y))
  controls.update()
  renderer.render(scene, camera)

  for (const a of staff) {
    a.char.group.getWorldPosition(head)
    head.y += a.char.top + 0.12
    head.project(camera)
    const x = (head.x * 0.5 + 0.5) * innerWidth
    const y = (-head.y * 0.5 + 0.5) * innerHeight
    a.bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
    if (pointerSeen && Math.abs(a.heading) < 1.1 && a.mode !== 'sleep') {
      const px = ((pointer.x + 1) / 2) * innerWidth
      const py = ((1 - pointer.y) / 2) * innerHeight
      const dx = px - x
      const dy = py - (y + 30)
      const d = Math.hypot(dx, dy) || 1
      const pull = Math.min(1, d / 140)
      a.char.look((dx / d) * pull, (-dy / d) * pull)
    } else a.char.look(0, 0)
  }
  requestAnimationFrame(frame)
}

function say() {
  const open = isOpen()
  for (const a of staff) {
    const task = taskOf(a.file)
    let text = ''
    let kind = ''
    if (!open) [text, kind] = ['z z z', 'sleep']
    else if (task) [text, kind] = [`${STATUS[task.status]}: ${short(task.task, 34)}`, task.status]
    else if (a.cheer > 0) [text, kind] = ['Done', 'done']
    else if (a.hover || a.file === openFile) text = a.agent.job
    if (text !== a.said) {
      a.said = text
      a.bubble.textContent = text
      a.bubble.className = text ? `bubble on ${kind}` : 'bubble'
    }
  }
}

function tick() {
  const d = now()
  const open = isOpen(d)
  $('clock-time').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  $('clock-note').textContent = (open ? 'Open until 22:00' : 'Closed until 06:00') + (shift ? ' · preview' : '')
  $('clock').classList.toggle('closed', !open)
  if (document.body.classList.contains('closed') === open) {
    document.body.classList.toggle('closed', !open)
    if (openFile && !editing) renderNow()
  }
}

// ---------- server ----------
async function api(method, path, data) {
  const r = await fetch(path, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined })
  const out = await r.json()
  if (!r.ok) throw new Error(out.error || 'That did not work')
  return out
}

function take(state) {
  for (const task of state.tasks) {
    const before = shared.tasks.find((t) => t.id === task.id)
    if (before && before.status === 'running' && task.status === 'done') {
      const a = staff.find((x) => x.file === task.agent)
      if (a) a.cheer = 2.4
    }
  }
  const changed = JSON.stringify(state.tasks) !== JSON.stringify(shared.tasks) || JSON.stringify(state.activities) !== JSON.stringify(shared.activities)
  shared = { activities: state.activities, tasks: state.tasks }
  if (changed && openFile && !editing) renderNow()
}

async function act(run) {
  try {
    take(await run())
  } catch (e) {
    notice = { kind: 'bad', text: e.message }
    renderNow()
  }
}

function setActivity(file, activity) {
  if (live) return act(() => api('PUT', `api/activity/${file}`, { activity }))
  shared.activities[file] = activity
  renderNow()
}

// ---------- dock ----------
function dock() {
  const depts = departments()
  $('dock').replaceChildren(
    ...staff.map((a) =>
      el(
        'button',
        { type: 'button', 'data-file': a.file, 'aria-pressed': String(a.file === openFile), onclick: () => select(a.file) },
        el('span', { class: 'face', html: window.avatarSVG(a.agent, depts.find((d) => d.name === a.agent.department).tint) }),
        el('span', { text: a.agent.job }),
      ),
    ),
  )
  const mode = $('mode')
  mode.className = live ? 'mode live' : 'mode'
  mode.textContent = live ? 'Editing on' : 'View only · run node office.mjs to edit'
}

// ---------- panel ----------
function head2(agent, dept) {
  return [
    el('button', { type: 'button', class: 'x', 'aria-label': 'Close', text: '×', onclick: hide }),
    el(
      'div',
      { class: 'who', style: `--hue:${dept.hue}` },
      el('div', { class: 'face', html: window.avatarSVG(agent, dept.tint) }),
      el('div', {}, el('h2', { id: 'panel-title', text: agent.job }), el('p', { text: `${agent.name} · ${dept.name}` })),
    ),
  ]
}

function taskItem(task) {
  const item = el('li', { class: `task ${task.status}` }, el('span', { class: 'pill', text: STATUS[task.status] }), el('p', { text: task.task }))
  const row = el('div', { class: 'row' })
  const button = (text, run) => row.append(el('button', { type: 'button', class: 'link', text, onclick: run }))
  if (task.status === 'failed') item.append(el('p', { class: 'note bad', text: task.error || 'Failed' }))
  if (task.status === 'done') {
    button(results.has(task.id) ? 'Hide result' : 'Show result', async () => {
      if (results.has(task.id)) results.delete(task.id)
      else results.set(task.id, await fetch(`api/tasks/${task.id}/result`).then((r) => (r.ok ? r.text() : 'The result file is missing.')))
      renderNow()
    })
  }
  if (task.status === 'running' || task.status === 'failed') button(task.status === 'failed' ? 'Try again' : 'Back to queue', () => act(() => api('POST', `api/tasks/${task.id}/requeue`)))
  if (task.status !== 'running') button(task.status === 'queued' ? 'Cancel' : 'Remove', () => act(() => api('DELETE', `api/tasks/${task.id}`)))
  item.append(row)
  if (results.has(task.id)) item.append(el('div', { class: 'prose result', html: markdown(results.get(task.id), true) }))
  return item
}

// Only this part is redrawn when the queue changes, so a half-typed task is never lost.
function renderNow() {
  const box = $('now')
  const agent = find(openFile)
  if (!box || !agent) return
  const open = isOpen()
  const current = shared.activities[agent.file] || 'auto'
  const mine = shared.tasks.filter((t) => t.agent === agent.file).reverse()
  const parts = [
    el(
      'div',
      { class: 'acts', role: 'group', 'aria-label': 'Doing now' },
      ...ACTIVITIES.map(([id, label]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(id === current), text: label, onclick: () => setActivity(agent.file, id) })),
    ),
    !open && el('p', { class: 'note', text: 'Asleep until 06:00. Whatever you pick starts in the morning.' }),
    mine.length ? el('ul', { class: 'tasks' }, ...mine.map(taskItem)) : null,
    notice && notice.kind === 'bad' ? el('p', { class: 'note bad', text: notice.text }) : null,
  ]
  box.replaceChildren(...parts.filter(Boolean))
}

function view2(agent, dept) {
  const tools = agent.tools ? agent.tools.split(',').map((t) => t.trim()) : ['All tools']
  const text = el('textarea', { name: 'task', required: true, maxlength: 4000, rows: 3, 'aria-label': 'Task', placeholder: `What should ${agent.job} do?` })
  const give = el(
    'form',
    {
      class: 'give',
      onsubmit: (e) => {
        e.preventDefault()
        const task = text.value.trim()
        if (!task) return
        notice = null
        act(async () => {
          const state = await api('POST', 'api/tasks', { agent: agent.file, task })
          text.value = ''
          return state
        })
      },
    },
    text,
    el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary', text: 'Give task' }), el('p', { class: 'note', text: 'Starts when you tell Claude: run the agency' })),
  )
  return [
    ...head2(agent, dept),
    el('h3', { text: 'Doing now' }),
    el('div', { id: 'now' }),
    el('h3', { text: 'Task' }),
    live ? give : el('p', { class: 'note', text: 'Start the office with node office.mjs to give tasks.' }),
    el('h3', { text: 'Use when' }),
    el('p', { class: 'lead', text: agent.description }),
    el('h3', { text: 'Tools' }),
    el('ul', { class: 'chips' }, ...tools.map((t) => el('li', { text: t }))),
    el('h3', { text: 'Function' }),
    el(
      'div',
      { class: 'actions top' },
      live && el('button', { type: 'button', class: 'btn', text: 'Change function', onclick: () => ((editing = true), (notice = null), renderPanel()) }),
      el('p', { class: notice && notice.kind === 'ok' ? 'note ok' : 'note', text: notice && notice.kind === 'ok' ? notice.text : `agents/${agent.file}` }),
    ),
    el('div', { class: 'prose', html: markdown(agent.body) }),
  ]
}

const field = (label, control) => el('label', {}, label, control)
const chooser = (name, options, value) => el('select', { name }, ...options.map((o) => el('option', { value: o, selected: String(o) === String(value), text: String(o) })))

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
          agents = await api('PUT', `api/agents/${agent.file}`, Object.fromEntries(new FormData(f)))
          editing = false
          notice = { kind: 'ok', text: 'Saved and installed in Claude Code' }
          buildWorld()
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
    agent.avatar === 'helper' && el('div', { class: 'trio' }, field('Eyes', chooser('eyes', [1, 2], agent.eyes)), field('Hair', chooser('hair', HAIR, agent.hair)), field('Holding', chooser('prop', PROPS, agent.prop))),
    field('Use when', description),
    field('Function', body),
    el('div', { class: 'actions' }, submit, el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => ((editing = false), renderPanel()) }), status),
  )
  return [...head2(agent, dept), f]
}

function renderPanel() {
  const agent = find(openFile)
  if (!agent) return hide()
  const dept = departments().find((d) => d.name === agent.department)
  panel.replaceChildren(...(editing ? form(agent, dept) : view2(agent, dept)))
  panel.scrollTop = 0
  if (!editing) renderNow()
}

function select(file) {
  if (editing && file !== openFile && !confirm('Discard your changes?')) return
  openFile = file
  editing = false
  notice = null
  panel.hidden = false
  document.body.classList.add('panel-open')
  renderPanel()
  const a = staff.find((x) => x.file === file)
  if (a) a.hop = 0.5
  for (const b of $('dock').children) b.setAttribute('aria-pressed', String(b.dataset.file === file))
  resize()
  aim()
  say()
}

function hide() {
  if (editing && !confirm('Discard your changes?')) return
  openFile = null
  editing = false
  panel.hidden = true
  document.body.classList.remove('panel-open')
  for (const b of $('dock').children) b.setAttribute('aria-pressed', 'false')
  resize()
  aim()
  say()
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openFile) hide()
})

// ---------- start ----------
camera.position.set(Math.sin(0.34) * 40, 4, Math.cos(0.34) * 40)
buildWorld()
resize()
controls.target.copy(view.goal)
camera.position.set(Math.sin(0.34) * view.dist, view.goal.y + view.dist * 0.07, Math.cos(0.34) * view.dist)
tick()
say()
setInterval(tick, 1000)
setInterval(say, 300)
requestAnimationFrame(frame)

// With office.mjs running the page reads the agent files directly, saves changes back and keeps the task queue.
async function connect() {
  try {
    agents = await api('GET', 'api/agents')
    take(await api('GET', 'api/state'))
    live = true
    buildWorld()
    setInterval(() => api('GET', 'api/state').then(take).catch(() => {}), 2500)
  } catch {}
}
if (location.protocol.startsWith('http')) connect()
