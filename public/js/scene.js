// The office itself: an isometric, top-down 3D floor with a desk for every agent.
// It only draws what it is told. What an agent does on screen follows its real status:
// typing happens while a task is really running, never as decoration.
import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { makeCharacter } from './characters.js'

const HUES = [164, 258, 336, 204, 24, 78]
const BODIES = ['#8fe3c3', '#c8b6ff', '#ffadc9', '#8fd3ff', '#ffc59e', '#d3ec8c']
const MARGIN = 1.3
const GAP = 1.1
const CORRIDOR = 2.4
const CELL = 0.35
const SPEED = 1.9
const WALL = 2.5
const AZIMUTH = 0.56
const ELEVATION = 0.72

const rand = (a, b) => a + Math.random() * (b - a)
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra })
const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l)
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material.isMaterial ? material : std(material))
  m.position.set(x, y, z)
  return m
}
function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material.isMaterial ? material : std(material))
  m.position.set(x, y, z)
  return m
}
function flat(w, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material)
  m.rotation.x = -Math.PI / 2
  m.position.set(x, y, z)
  m.userData.flat = true
  return m
}

function textTexture(lines, { width = 512, height = 128, bg = null, color = '#1b1a1f', font = 'ui-monospace, "Cascadia Code", Consolas, monospace', weight = 700, size = 56, spacing = 3, align = 'center' } = {}) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const g = c.getContext('2d')
  if (bg) {
    g.fillStyle = bg
    g.fillRect(0, 0, width, height)
  }
  g.textAlign = align
  g.textBaseline = 'middle'
  g.fillStyle = color
  if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`
  lines = [].concat(lines)
  let px = size
  const fits = () => lines.every((s) => g.measureText(s).width <= width - 40)
  g.font = `${weight} ${px}px ${font}`
  while (px > 18 && !fits()) g.font = `${weight} ${(px -= 2)}px ${font}`
  if (!fits() && lines.length === 1 && lines[0].includes(' ')) {
    const words = lines[0].split(' ')
    const half = Math.ceil(words.length / 2)
    return textTexture([words.slice(0, half).join(' '), words.slice(half).join(' ')], { width, height, bg, color, font, weight, size: Math.min(size, 40), spacing, align })
  }
  const x = align === 'left' ? 24 : width / 2
  lines.forEach((s, i) => g.fillText(s, x, height / 2 + (i - (lines.length - 1) / 2) * px * 1.25))
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// ---------- floor plan ----------
// Departments become zones. Zones are packed into two rows with a corridor between them; the lounge closes the second row.
function layout(agents) {
  const byDept = new Map()
  for (const a of agents) {
    if (!byDept.has(a.department)) byDept.set(a.department, { name: a.department, floor: a.floor, staff: [] })
    const z = byDept.get(a.department)
    z.staff.push(a)
    z.floor = Math.max(z.floor, a.floor)
  }
  const zones = [...byDept.values()].sort((a, b) => b.floor - a.floor || a.name.localeCompare(b.name))
  let tint = 0
  for (const z of zones) {
    z.boss = z.staff.some((a) => a.is_manager)
    z.tint = z.boss ? -1 : tint++
    z.hue = z.boss ? 26 : HUES[z.tint % HUES.length]
    const n = z.staff.length
    z.cols = n <= 3 ? n : Math.ceil(n / 2)
    z.rows = Math.ceil(n / z.cols)
    z.w = z.cols * 3.3 + 1.4
    z.d = z.rows * 3.7 + 1.1
  }
  const lounge = { lounge: true, name: 'Lounge', w: 7.4, d: 5.9, hue: 38, staff: [] }
  const all = [...zones, lounge]
  const total = all.reduce((s, z) => s + z.w + GAP, -GAP)
  const top = []
  const bottom = []
  let acc = 0
  for (const z of all) {
    if (!z.lounge && (!top.length || acc + z.w / 2 <= total / 2)) {
      top.push(z)
      acc += z.w + GAP
    } else bottom.push(z)
  }
  if (!top.length) top.push(bottom.shift())
  const deepest = (row) => (row.length ? Math.max(...row.map((z) => z.d)) : 0)
  const span = (row) => row.reduce((s, z) => s + z.w + GAP, -GAP)
  const width = Math.max(span(top), span(bottom)) + MARGIN * 2
  // The first row starts at the wall; a shorter second row is centred under it.
  const place = (row, z0, x0) => {
    let x = x0
    for (const z of row) {
      z.x = x
      z.z = z0
      x += z.w + GAP
    }
    return x - GAP
  }
  const topDepth = deepest(top)
  const topEnd = place(top, MARGIN, MARGIN)
  place(bottom, MARGIN + topDepth + CORRIDOR, (width - span(bottom)) / 2)
  const depth = MARGIN + topDepth + (bottom.length ? CORRIDOR + deepest(bottom) : 0) + MARGIN
  // Spare room at the end of the first row becomes the meeting corner.
  const spare = width - MARGIN - topEnd - GAP
  const meeting = spare >= 4.6 ? { x: topEnd + GAP, z: MARGIN, w: spare, d: Math.min(topDepth, 5.4) } : null

  for (const z of zones) {
    z.staff.forEach((a, i) => {
      const col = i % z.cols
      const row = Math.floor(i / z.cols)
      a._desk = { x: z.x + 0.7 + 1.65 + col * 3.3, z: z.z + 2.05 + row * 3.7 }
      a._zone = z
    })
  }
  return { zones, lounge, meeting, width, depth }
}

// ---------- walking ----------
function makeGrid(width, depth, blocks) {
  const nx = Math.ceil(width / CELL)
  const nz = Math.ceil(depth / CELL)
  const blocked = new Uint8Array(nx * nz)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * CELL
      const z = (j + 0.5) * CELL
      let hit = x < 0.45 || z < 0.45 || x > width - 0.3 || z > depth - 0.3
      for (let k = 0; !hit && k < blocks.length; k++) {
        const b = blocks[k]
        hit = x > b.x0 - b.pad && x < b.x1 + b.pad && z > b.z0 - b.pad && z < b.z1 + b.pad
      }
      blocked[j * nx + i] = hit ? 1 : 0
    }
  }
  const cell = (x, z) => [Math.min(nx - 1, Math.max(0, Math.floor(x / CELL))), Math.min(nz - 1, Math.max(0, Math.floor(z / CELL)))]
  const free = (x, z) => {
    const [i, j] = cell(x, z)
    return !blocked[j * nx + i]
  }
  const nearest = (x, z) => {
    const [ci, cj] = cell(x, z)
    for (let r = 0; r < 14; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= nx || j >= nz || Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue
          if (!blocked[j * nx + i]) return [i, j]
        }
      }
    }
    return [ci, cj]
  }
  const clear = (a, b) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15)
    for (let s = 1; s < steps; s++) if (!free(a.x + ((b.x - a.x) * s) / steps, a.z + ((b.z - a.z) * s) / steps)) return false
    return true
  }
  // Breadth-first search on the grid, then the zig-zag is pulled straight wherever there is a clear line.
  function path(from, to) {
    if (Math.hypot(from.x - to.x, from.z - to.z) < 0.08) return []
    const [si, sj] = nearest(from.x, from.z)
    const [ti, tj] = nearest(to.x, to.z)
    const prev = new Int32Array(nx * nz).fill(-1)
    const start = sj * nx + si
    const goal = tj * nx + ti
    const queue = [start]
    prev[start] = start
    for (let q = 0; q < queue.length && prev[goal] < 0; q++) {
      const cur = queue[q]
      const i = cur % nx
      const j = (cur - i) / nx
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue
        const n = nj * nx + ni
        if (blocked[n] || prev[n] >= 0) continue
        prev[n] = cur
        queue.push(n)
      }
    }
    if (prev[goal] < 0) return [{ x: to.x, z: to.z }]
    const cells = []
    for (let c = goal; c !== start; c = prev[c]) cells.push(c)
    const pts = [{ x: from.x, z: from.z }, ...cells.reverse().map((c) => ({ x: ((c % nx) + 0.5) * CELL, z: (Math.floor(c / nx) + 0.5) * CELL })), { x: to.x, z: to.z }]
    const out = []
    let at = 0
    while (at < pts.length - 1) {
      let next = pts.length - 1
      while (next > at + 1 && !clear(pts[at], pts[next])) next--
      out.push(pts[next])
      at = next
    }
    return out
  }
  const spot = (x0, z0, x1, z1) => {
    for (let n = 0; n < 40; n++) {
      const p = { x: rand(x0, x1), z: rand(z0, z1) }
      if (free(p.x, p.z)) return p
    }
    return null
  }
  return { path, free, spot }
}

// ---------- furniture ----------
function plant(scale = 1) {
  const g = new THREE.Group()
  g.add(cyl(0.22, 0.16, 0.36, 0xd9825b, 0, 0.18, 0, 14))
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

function chair(color) {
  const g = new THREE.Group()
  const fabric = std(color)
  g.add(box(0.52, 0.09, 0.5, fabric, 0, 0.44, 0), box(0.52, 0.56, 0.08, fabric, 0, 0.76, -0.23))
  g.add(cyl(0.035, 0.035, 0.36, 0x2b2c38, 0, 0.22, 0, 8), cyl(0.26, 0.28, 0.05, 0x2b2c38, 0, 0.04, 0, 5))
  return g
}

export function createScene({ canvas, tags, onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600)
  const controls = new MapControls(camera, canvas)
  controls.enableDamping = true
  controls.screenSpacePanning = false
  controls.zoomToCursor = true
  controls.minPolarAngle = controls.maxPolarAngle = Math.PI / 2 - ELEVATION
  controls.minAzimuthAngle = AZIMUTH - 0.55
  controls.maxAzimuthAngle = AZIMUTH + 0.55

  const hemi = new THREE.HemisphereLight(0xfff6e8, 0x8a8494, 1)
  const sun = new THREE.DirectionalLight(0xfff1dc, 1)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.03
  scene.add(hemi, sun, sun.target)

  const skyMat = new THREE.MeshBasicMaterial({ color: 0x86bdf5 })
  const NIGHT = new THREE.Color(0x0b1030)
  const DAY = new THREE.Color(0x9fd0ff)
  const DUSK = new THREE.Color(0xf08a5d)
  const sky = new THREE.Color()

  let world = null
  let wallMat = null
  let plan = null
  let grid = null
  let staff = []
  let screens = []
  let pickables = []
  let signature = ''
  let board = null
  let boardText = ''
  let open = true
  let selected = null
  let preview = null
  let fitZoom = 30
  let cover = { left: 0, right: 0, bottom: 0 }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }))
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  scene.add(ring)

  const view = { target: new THREE.Vector3(), zoom: 30, auto: true }
  controls.addEventListener('start', () => (view.auto = false))

  // A pane that is not laid out yet reports a 0x0 window, so never size from zero.
  const size = () => [innerWidth || 1100, innerHeight || 700]

  function desk(group, agent, hue) {
    const boss = Boolean(agent.is_manager)
    const g = new THREE.Group()
    g.position.set(agent._desk.x, 0, agent._desk.z)
    const s = boss ? 1.18 : 1
    const wood = std(boss ? 0x5b4336 : 0xd2a777)
    const dark = std(boss ? 0x3a2c25 : 0x9b6f47)
    g.add(box(1.9 * s, 0.07, 0.85, wood, 0, 0.6, 0), box(1.7 * s, 0.57, 0.05, dark, 0, 0.285, 0.36))
    g.add(box(0.06, 0.57, 0.72, dark, -0.85 * s, 0.285, 0), box(0.06, 0.57, 0.72, dark, 0.85 * s, 0.285, 0))
    const plateTex = textTexture(agent.role.toUpperCase(), { bg: boss ? '#f1b676' : '#f6e8c3', size: boss ? 60 : 50, spacing: boss ? 10 : 3 })
    const cream = std(boss ? 0xeaa565 : 0xecd9a8)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.38, 0.03), [cream, cream, cream, cream, new THREE.MeshBasicMaterial({ map: plateTex }), cream])
    plate.position.set(0, 0.29, 0.4)
    g.add(plate)

    const laptop = new THREE.Group()
    laptop.position.set(-0.5, 0.64, -0.1)
    laptop.rotation.y = 0.3
    laptop.add(box(0.5, 0.02, 0.34, 0x4a4d5e))
    const lid = new THREE.Group()
    lid.position.set(0, 0.01, 0.17)
    lid.rotation.x = 0.3
    lid.add(box(0.5, 0.34, 0.02, 0x343645, 0, 0.17, 0))
    const glow = new THREE.MeshBasicMaterial({ color: agent.color })
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), glow)
    dot.position.set(0, 0.17, 0.012)
    const screen = new THREE.MeshBasicMaterial({ color: 0xdfeaff })
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3), screen)
    face.position.set(0, 0.17, -0.012)
    face.rotation.y = Math.PI
    lid.add(dot, face)
    laptop.add(lid)
    g.add(laptop, cyl(0.055, 0.048, 0.1, 0xf1eee8, 0.68 * s, 0.685, 0.12, 14))
    g.add(box(0.3, 0.02, 0.22, 0xf6f3ec, 0.25 * s, 0.645, -0.15))
    const seat = chair(hsl(hue, 0.3, 0.42))
    seat.position.set(0, 0, -1.45)
    g.add(seat)
    g.userData.id = agent.id
    group.add(g)
    pickables.push(g)
    screens.push({ id: agent.id, screen, glow, color: new THREE.Color(agent.color) })
  }

  function build(agents) {
    if (world) {
      scene.remove(world)
      world.traverse((o) => {
        o.geometry?.dispose()
        for (const m of [].concat(o.material || [])) {
          if (m === skyMat) continue
          m.map?.dispose()
          m.dispose()
        }
      })
      tags.replaceChildren()
    }
    const old = new Map(staff.map((a) => [a.id, a]))
    world = new THREE.Group()
    staff = []
    screens = []
    pickables = []
    plan = layout(agents)
    const { width, depth, zones, lounge, meeting } = plan
    const blocks = []
    const block = (x0, z0, x1, z1, pad = 0.22) => blocks.push({ x0, z0, x1, z1, pad })

    // slab, floor, walls
    const slab = box(width + 0.5, 0.5, depth + 0.5, 0x2a2c3a, width / 2, -0.26, depth / 2)
    const floor = flat(width, depth, std(0xd9d2c6), width / 2, 0, depth / 2)
    world.add(slab, floor)
    wallMat = std(0xefe9df, { emissive: 0x4d4840 })
    const walls = [box(width + 0.25, WALL, 0.2, wallMat, width / 2, WALL / 2, -0.1), box(0.2, WALL, depth + 0.1, wallMat, -0.1, WALL / 2, depth / 2 - 0.05)]
    world.add(...walls)
    world.add(box(width, 0.14, 0.04, 0xc9c0b2, width / 2, 0.07, 0.02), box(0.04, 0.14, depth, 0xc9c0b2, 0.02, 0.07, depth / 2))
    for (let x = 2.2; x < width - 1.6; x += 4.4) {
      world.add(box(2.4, 1.25, 0.05, 0x3a3d4c, x, 1.55, 0.02))
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.05), skyMat)
      glass.position.set(x, 1.55, 0.05)
      world.add(glass, box(0.05, 1.05, 0.02, 0x3a3d4c, x, 1.55, 0.06))
    }
    for (let z = 2.4; z < depth - 1.6; z += 4.6) {
      world.add(box(0.05, 1.25, 2.4, 0x3a3d4c, 0.02, 1.55, z))
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.05), skyMat)
      glass.rotation.y = Math.PI / 2
      glass.position.set(0.05, 1.55, z)
      world.add(glass)
    }

    // zones
    for (const zone of zones) {
      world.add(flat(zone.w, zone.d, std(hsl(zone.hue, 0.42, 0.74)), zone.x + zone.w / 2, 0.006, zone.z + zone.d / 2))
      const label = flat(Math.min(zone.w - 0.4, 4.6), 0.52, new THREE.MeshBasicMaterial({ map: textTexture(zone.name.toUpperCase(), { width: 1024, height: 116, color: `hsl(${zone.hue} 45% 30%)`, size: 78, spacing: 10, weight: 800 }), transparent: true, depthWrite: false }), zone.x + zone.w / 2, 0.012, zone.z + zone.d - 0.42)
      world.add(label)
      for (const agent of zone.staff) {
        desk(world, agent, zone.hue)
        const d = agent._desk
        const half = agent.is_manager ? 1.12 : 0.95
        block(d.x - half, d.z - 0.43, d.x + half, d.z + 0.43)
        block(d.x - 0.3, d.z - 1.75, d.x + 0.3, d.z - 1.15, 0.05)
        const char = makeCharacter({ ...agent.look, color: agent.color }, BODIES[Math.max(0, zone.tint) % BODIES.length])
        char.group.userData.id = agent.id
        const shadow = flat(0.74, 0.74, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }), 0, 0.014, 0)
        shadow.geometry = new THREE.CircleGeometry(0.37, 20)
        char.group.add(shadow)
        world.add(char.group)
        pickables.push(char.group)
        const home = { x: d.x, z: d.z - 0.78 }
        const tag = document.createElement('button')
        tag.type = 'button'
        tag.className = 'tag'
        tag.innerHTML = '<i></i><b></b><em></em>'
        tag.querySelector('b').textContent = agent.role
        tag.addEventListener('click', () => onPick(agent.id))
        tags.append(tag)
        const before = old.get(agent.id)
        staff.push({
          id: agent.id, agent, zone, char, home, tag,
          pos: before ? { ...before.pos } : { ...home }, face: 0, heading: before ? before.heading : 0, path: [], mode: '', wait: 0,
          seed: Math.random() * 10, auto: { mode: 'rest', until: rand(6, 30) }, hop: 0, cheer: 0, hover: false,
          state: 'idle', text: '', said: '', kind: '',
        })
      }
      const corner = plant(1.2)
      corner.position.set(zone.x + zone.w - 0.45, 0, zone.z + 0.45)
      world.add(corner)
      block(zone.x + zone.w - 0.75, zone.z + 0.15, zone.x + zone.w - 0.15, zone.z + 0.75, 0.1)
    }

    // lounge: coffee counter, sofa, low table
    {
      const L = lounge
      world.add(flat(L.w, L.d, std(0xe7c9a0), L.x + L.w / 2, 0.006, L.z + L.d / 2))
      world.add(flat(2.4, 0.5, new THREE.MeshBasicMaterial({ map: textTexture('LOUNGE', { width: 512, height: 108, color: '#7a5a2e', size: 76, spacing: 10, weight: 800 }), transparent: true, depthWrite: false }), L.x + L.w / 2, 0.012, L.z + L.d - 0.42))
      const cx = L.x + 1.5
      const cz = L.z + 0.55
      world.add(box(2.6, 0.9, 0.7, 0x4a4d5e, cx, 0.45, cz), box(2.7, 0.06, 0.8, 0xf1eee8, cx, 0.93, cz))
      world.add(box(0.5, 0.6, 0.45, 0x23242e, cx - 0.7, 1.26, cz), box(0.36, 0.06, 0.2, 0xd97757, cx - 0.7, 1.42, cz + 0.24))
      for (const dx of [0.1, 0.32, 0.54]) world.add(cyl(0.055, 0.048, 0.1, 0xf1eee8, cx + dx, 1.01, cz + 0.1, 12))
      block(cx - 1.35, cz - 0.4, cx + 1.35, cz + 0.4)
      L.coffee = [-0.9, -0.1, 0.7].map((dx) => ({ x: cx + dx, z: cz + 1.05 }))
      const sx = L.x + L.w - 2.1
      const sz = L.z + 3.3
      const sofa = std(0x5b6ee1)
      world.add(box(2.6, 0.42, 0.9, sofa, sx, 0.21, sz - 1.25), box(2.6, 0.5, 0.22, sofa, sx, 0.63, sz - 1.6), box(0.9, 0.42, 1.7, sofa, sx + 0.85, 0.21, sz + 0.05))
      world.add(box(0.22, 0.5, 1.7, sofa, sx + 1.2, 0.63, sz + 0.05))
      world.add(cyl(0.55, 0.55, 0.06, 0xf1eee8, sx - 0.55, 0.42, sz + 0.1, 28), cyl(0.07, 0.07, 0.4, 0x2b2c38, sx - 0.55, 0.2, sz + 0.1, 10))
      block(sx - 1.3, sz - 1.75, sx + 1.3, sz - 0.8)
      block(sx + 0.4, sz - 0.8, sx + 1.35, sz + 0.9)
      block(sx - 1.1, sz - 0.45, sx, sz + 0.65, 0.1)
      const p = plant(1.5)
      p.position.set(L.x + L.w - 0.5, 0, L.z + 0.5)
      world.add(p)
      block(L.x + L.w - 0.85, L.z + 0.15, L.x + L.w - 0.15, L.z + 0.85, 0.1)
    }

    // meeting corner with the status board
    if (meeting) {
      const mx = meeting.x + meeting.w / 2
      const mz = meeting.z + Math.min(meeting.d / 2 + 0.4, 2.9)
      world.add(flat(meeting.w, meeting.d, std(0xc9d6e6), mx, 0.006, meeting.z + meeting.d / 2))
      world.add(cyl(1.05, 1.05, 0.07, 0xf1eee8, mx, 0.72, mz, 36), cyl(0.12, 0.3, 0.7, 0x4a4d5e, mx, 0.35, mz, 16))
      block(mx - 1.05, mz - 1.05, mx + 1.05, mz + 1.05)
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4
        world.add(cyl(0.24, 0.24, 0.42, 0x6b7280, mx + Math.cos(a) * 1.5, 0.21, mz + Math.sin(a) * 1.5, 16))
        block(mx + Math.cos(a) * 1.5 - 0.24, mz + Math.sin(a) * 1.5 - 0.24, mx + Math.cos(a) * 1.5 + 0.24, mz + Math.sin(a) * 1.5 + 0.24, 0.08)
      }
      const frame = box(2.7, 1.5, 0.06, 0x3a3d4c, mx, 1.5, 0.05)
      board = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.3), new THREE.MeshBasicMaterial({ color: 0xffffff }))
      board.position.set(mx, 1.5, 0.09)
      world.add(frame, board)
      boardText = ''
    } else board = null

    // a shelf on the west wall
    {
      const z = plan.depth - 2.2
      world.add(box(0.45, 1.7, 1.8, 0x9b6f47, 0.3, 0.85, z))
      for (let i = 0; i < 3; i++) for (let k = 0; k < 5; k++) world.add(box(0.3, 0.34, 0.16, hsl((i * 97 + k * 53) % 360, 0.45, 0.6), 0.36, 0.42 + i * 0.52, z - 0.62 + k * 0.3))
      block(0.05, z - 0.95, 0.55, z + 0.95, 0.1)
    }

    world.traverse((o) => {
      if (!o.isMesh) return
      const basic = [].concat(o.material).every((m) => m.isMeshBasicMaterial)
      o.castShadow = !o.userData.flat && !basic
      o.receiveShadow = !basic
    })
    slab.castShadow = false
    for (const w of walls) w.receiveShadow = false
    scene.add(world)
    grid = makeGrid(width, depth, blocks)

    const reach = Math.max(width, depth) * 0.8
    sun.target.position.set(width / 2, 0, depth / 2)
    sun.position.set(width / 2 - 5, 24, depth / 2 + 13)
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 70 })
    sun.shadow.camera.updateProjectionMatrix()
    frame()
    if (view.auto) aim()
  }

  // ---------- camera ----------
  function place(target) {
    const r = 120
    camera.position.set(target.x + r * Math.sin(AZIMUTH) * Math.cos(ELEVATION), target.y + r * Math.sin(ELEVATION), target.z + r * Math.cos(AZIMUTH) * Math.cos(ELEVATION))
    controls.target.copy(target)
    camera.lookAt(target)
    camera.updateMatrixWorld()
  }

  // How many pixels per unit make the whole floor fit into the part of the window that panels leave free.
  function frame() {
    if (!plan) return
    const [w, h] = size()
    const right = new THREE.Vector3(Math.cos(AZIMUTH), 0, -Math.sin(AZIMUTH))
    const up = new THREE.Vector3(-Math.sin(AZIMUTH) * Math.sin(ELEVATION), Math.cos(ELEVATION), -Math.cos(AZIMUTH) * Math.sin(ELEVATION))
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const x of [0, plan.width]) for (const z of [0, plan.depth]) for (const y of [-0.5, WALL]) {
      const p = new THREE.Vector3(x, y, z)
      u0 = Math.min(u0, p.dot(right)); u1 = Math.max(u1, p.dot(right))
      v0 = Math.min(v0, p.dot(up)); v1 = Math.max(v1, p.dot(up))
    }
    const freeW = Math.max(240, w - cover.left - cover.right)
    const freeH = Math.max(220, h - cover.bottom - 150)
    fitZoom = Math.min(freeW / (u1 - u0), freeH / (v1 - v0)) * 0.94
    controls.minZoom = fitZoom * 0.6
    controls.maxZoom = Math.max(fitZoom * 5, 110)
  }

  function aim() {
    const a = staff.find((x) => x.id === selected)
    if (a) {
      view.target.set(a.pos.x, 0.7, a.pos.z)
      view.zoom = Math.min(controls.maxZoom, Math.max(fitZoom * 2.3, 62))
    } else if (plan) {
      view.target.set(plan.width / 2, 0.5, plan.depth / 2)
      view.zoom = fitZoom
    }
    view.auto = true
  }

  function resize() {
    const [w, h] = size()
    renderer.setSize(w, h, false)
    Object.assign(camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 })
    if (cover.left || cover.right || cover.bottom) camera.setViewOffset(w, h, (cover.right - cover.left) / 2, cover.bottom / 2, w, h)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
    frame()
  }

  // ---------- behaviour ----------
  function go(a, mode, t) {
    a.mode = mode
    let to = a.home
    let face = 0.22
    if (mode === 'coffee') {
      to = plan.lounge.coffee[staff.indexOf(a) % plan.lounge.coffee.length]
      face = Math.PI
    } else if (mode === 'walk') {
      to = grid.spot(0.8, 0.8, plan.width - 0.8, plan.depth - 0.8) || a.home
      face = rand(-0.8, 0.8)
    } else if (mode === 'dance') {
      to = { x: a.home.x, z: a.home.z + 2.25 }
    } else if (mode === 'chat') {
      const mates = staff.filter((b) => b !== a).sort((p, q) => (p.zone === a.zone ? 0 : 1) - (q.zone === a.zone ? 0 : 1) || Math.hypot(p.home.x - a.home.x, p.home.z - a.home.z) - Math.hypot(q.home.x - a.home.x, q.home.z - a.home.z))
      const mate = mates[0]
      if (mate) {
        const side = a.home.x >= mate.home.x ? 1.35 : -1.35
        to = { x: mate.home.x + side, z: mate.home.z + 0.1 }
        face = Math.atan2(mate.home.x - to.x, mate.home.z - to.z)
      }
    }
    a.path = grid.path(a.pos, to)
    a.face2 = face
    if (!a.path.length) a.face = face
    a.wait = t + rand(2, 5)
  }

  // What the agent should be doing right now, given its real status.
  function wanted(a, t) {
    if (!open) return 'sleep'
    if (a.state === 'working') return 'type'
    if (a.state === 'thinking') return 'think'
    if (a.state === 'needs_approval') return 'ready'
    if (a.state === 'error') return 'slump'
    if (a.state === 'waiting') return 'rest'
    const choice = a.agent.idle || 'auto'
    if (choice === 'desk') return 'rest'
    if (choice !== 'auto') return choice
    if (t > a.auto.until) a.auto = a.auto.mode === 'rest' ? { mode: pick(['coffee', 'walk', 'chat', 'walk']), until: t + rand(10, 18) } : { mode: 'rest', until: t + rand(18, 46) }
    return a.auto.mode
  }

  function step(a, t, dt) {
    if (a.cheer > 0) a.cheer -= dt
    if (a.hop > 0) a.hop -= dt
    const want = wanted(a, t)
    if (want !== a.mode) go(a, want, t)
    if (a.mode === 'walk' && !a.path.length && t > a.wait) go(a, 'walk', t)

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
          a.wait = t + rand(2, 5)
        }
      } else {
        a.pos.x += (dx / dist) * reach
        a.pos.z += (dz / dist) * reach
        a.face = Math.atan2(dx, dz)
      }
    }

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
    } else if (a.mode === 'type') {
      lx = -1.3 + Math.sin(t * 22 + s) * 0.11
      rx = c.prop ? -0.8 + Math.sin(t * 2 + s) * 0.07 : -1.3 + Math.sin(t * 22 + s + 2) * 0.11
      rz = c.prop ? 0.22 : 0
      y = Math.sin(t * 3 + s) * 0.012
      twist = -0.16
    } else if (a.mode === 'think') {
      lx = -2.25
      lz = 0.5
      rx = -0.35
      twist = Math.sin(t * 0.7 + s) * 0.25
      pitch = -0.05
      y = Math.sin(t * 1.4 + s) * 0.012
    } else if (a.mode === 'ready') {
      rz = 2.5 + Math.sin(t * 5 + s) * 0.25
      y = Math.abs(Math.sin(t * 2.2 + s)) * 0.04
    } else if (a.mode === 'slump') {
      pitch = 0.22
      lx = rx = 0.15
      y = -0.03
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
      twist = Math.sin(t * 0.5 + s) * 0.3
    }
    if (a.cheer > 0) {
      y += Math.abs(Math.sin(a.cheer * 8)) * 0.3
      lz = -2.6
      rz = 2.6
      lx = rx = 0
    }
    if (a.hover && !shut && !coffee && a.mode !== 'type') {
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
    if (c.rays) c.rays.rotation.z += dt * (a.mode === 'think' || a.mode === 'type' ? 1.6 : a.mode === 'sleep' ? 0 : 0.25)
    c.shut(shut || (t + s * 3) % 4.3 < 0.12)

    let turn = a.face - a.heading
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    a.heading += turn * (1 - Math.exp(-dt * 10))
    c.group.position.set(a.pos.x, 0, a.pos.z)
    c.group.rotation.y = a.heading
  }

  // ---------- pointer ----------
  const ray = new THREE.Raycaster()
  let down = null
  function pickAt(ev) {
    const r = canvas.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera)
    let o = ray.intersectObjects(pickables, true)[0]?.object
    while (o && !o.userData.id) o = o.parent
    return o ? o.userData.id : null
  }
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.buttons || ev.pointerType !== 'mouse') return
    const id = pickAt(ev)
    for (const a of staff) a.hover = a.id === id
    canvas.style.cursor = id ? 'pointer' : 'grab'
  })
  canvas.addEventListener('pointerleave', () => staff.forEach((a) => (a.hover = false)))
  canvas.addEventListener('pointerdown', (ev) => (down = [ev.clientX, ev.clientY]))
  canvas.addEventListener('pointerup', (ev) => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return
    onPick(pickAt(ev))
  })

  // ---------- loop ----------
  const timer = new THREE.Clock()
  const head = new THREE.Vector3()
  function tick() {
    requestAnimationFrame(tick)
    if (!world) return
    const dt = Math.min(timer.getDelta(), 0.05)
    const t = timer.elapsedTime
    const date = preview || new Date()
    const hour = date.getHours() + date.getMinutes() / 60
    const dl = Math.min(smooth(5, 8, hour), 1 - smooth(18.5, 21.5, hour))
    sky.copy(NIGHT).lerp(DAY, dl).lerp(DUSK, Math.sin(Math.PI * dl) * 0.45)
    skyMat.color.copy(sky)
    // By day the sun does the lighting; in the evening the office lights do; after closing only a dim night light stays.
    const lit = open ? 1 : 0.16
    hemi.intensity = (0.75 + 0.55 * dl) * (open ? 1 : 0.3)
    sun.intensity = (0.9 + 1.5 * dl) * lit
    sun.color.setHex(open ? 0xfff1dc : 0x8fa4ff)
    hemi.color.setHex(open ? 0xfff6e8 : 0x7f8fd6)
    if (wallMat) wallMat.emissiveIntensity = open ? 1 : 0.18

    for (const sc of screens) {
      const a = staff.find((x) => x.id === sc.id)
      const busy = open && a && (a.state === 'working' || a.state === 'thinking')
      sc.screen.color.setHex(open ? (busy ? 0xffffff : 0xb9c6dd) : 0x10111a)
      sc.glow.color.copy(sc.color).multiplyScalar(open ? (busy ? 0.6 + Math.abs(Math.sin(t * 6)) * 0.9 : 0.9) : 0.15)
    }
    for (const a of staff) step(a, t, dt)

    const chosen = staff.find((a) => a.id === selected)
    ring.visible = Boolean(chosen)
    if (chosen) {
      ring.position.set(chosen.pos.x, 0.03, chosen.pos.z)
      ring.scale.setScalar(1 + Math.sin(t * 4) * 0.06)
      if (view.auto) view.target.set(chosen.pos.x, 0.7, chosen.pos.z)
    }
    if (view.auto) {
      const k = 1 - Math.exp(-dt * 5)
      const delta = view.target.clone().sub(controls.target).multiplyScalar(k)
      controls.target.add(delta)
      camera.position.add(delta)
      camera.zoom += (view.zoom - camera.zoom) * k
      camera.updateProjectionMatrix()
    }
    if (plan) {
      controls.target.x = Math.max(-1, Math.min(plan.width + 1, controls.target.x))
      controls.target.z = Math.max(-1, Math.min(plan.depth + 1, controls.target.z))
    }
    controls.update()
    renderer.render(scene, camera)

    const [w, h] = size()
    tags.classList.toggle('far', camera.zoom < fitZoom * 1.25)
    for (const a of staff) {
      a.char.group.getWorldPosition(head)
      head.y += a.char.top + 0.1 + a.char.rig.position.y
      head.project(camera)
      a.tag.style.transform = `translate(${((head.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-head.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`
    }
  }

  function paintBoard(lines) {
    const text = lines.join('|')
    if (!board || text === boardText) return
    boardText = text
    board.material.map?.dispose()
    board.material.map = textTexture(lines, { width: 640, height: 332, bg: '#ffffff', color: '#1b1a1f', size: 44, spacing: 1, align: 'left', font: '"Segoe UI", system-ui, sans-serif' })
    board.material.needsUpdate = true
  }

  place(new THREE.Vector3(10, 0.5, 8))
  resize()
  requestAnimationFrame(tick)
  addEventListener('resize', () => {
    resize()
    if (view.auto) aim()
  })

  return {
    // agents: the roster; status: Map(id -> { state, text }); what: { open, selected, preview, board }
    sync(agents, status, what) {
      const sig = JSON.stringify(agents.map((a) => [a.id, a.role, a.department, a.floor, a.sort, a.color, a.look, a.is_manager]))
      if (sig !== signature) {
        signature = sig
        build(agents.map((a) => ({ ...a })))
      }
      open = what.open
      preview = what.preview || null
      for (const a of staff) {
        const fresh = agents.find((x) => x.id === a.id)
        if (fresh) a.agent.idle = fresh.idle
        const s = status.get(a.id) || { state: 'idle', text: '' }
        if (a.state !== 'completed' && s.state === 'completed') a.cheer = 2.4
        a.state = s.state
        const text = open ? s.text : 'Spí'
        const kind = open ? s.state : 'sleep'
        if (text !== a.said || kind !== a.kind || a.tag.classList.contains('on') !== (a.id === selected)) {
          a.said = text
          a.kind = kind
          a.tag.querySelector('em').textContent = text
          a.tag.className = `tag st-${kind}${text ? ' has' : ''}${a.id === selected ? ' on' : ''}`
        }
      }
      if (what.board) paintBoard(what.board)
    },
    select(id) {
      const changed = id !== selected
      selected = id
      const a = staff.find((x) => x.id === id)
      if (a && changed) a.hop = 0.5
      aim()
    },
    cover(left, right, bottom) {
      cover = { left, right, bottom }
      resize()
      if (view.auto) aim()
    },
    overview: () => aim(),
    zoom(factor) {
      view.auto = false
      camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, camera.zoom * factor))
      camera.updateProjectionMatrix()
    },
  }
}
