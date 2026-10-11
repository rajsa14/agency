// The staff in 3D. Helpers are capsule people with goggles; the CEO is the sunburst one.
// Every character returns the same handles so the office can animate them alike.
import * as THREE from 'three'

const INK = 0x1b1a1f
const UP = new THREE.Vector3(0, 1, 0)

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...extra })
const mesh = (geometry, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  return m
}
const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback)

function arm(x, y, handColor) {
  const g = new THREE.Group()
  g.position.set(x, y, 0)
  g.add(mesh(new THREE.CapsuleGeometry(0.042, 0.3, 4, 10), mat(INK), 0, -0.19, 0))
  g.add(mesh(new THREE.SphereGeometry(0.075, 14, 10), mat(handColor), 0, -0.4, 0))
  return g
}

function foot(x) {
  const f = mesh(new THREE.CapsuleGeometry(0.06, 0.1, 4, 10), mat(INK), x, 0.06, 0.03)
  f.rotation.x = Math.PI / 2
  return f
}

function mug() {
  const g = new THREE.Group()
  const white = mat(0xf1eee8)
  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.1, 14), white, 0, 0.03, 0.02))
  const handle = mesh(new THREE.TorusGeometry(0.032, 0.011, 6, 12), white, 0.06, 0.03, 0.02)
  g.add(handle)
  return g
}

const PROPS = {
  clipboard() {
    const g = new THREE.Group()
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.28, 0.02), mat(0xc79a5b), 0, 0.14, 0))
    g.add(mesh(new THREE.BoxGeometry(0.18, 0.22, 0.006), mat(0xffffff), 0, 0.13, 0.013))
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.04, 0.03), mat(0x8a93a3), 0, 0.28, 0))
    return g
  },
  pencil() {
    const g = new THREE.Group()
    g.add(mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 8), mat(0xffb347), 0, 0.15, 0))
    g.add(mesh(new THREE.ConeGeometry(0.026, 0.07, 8), mat(0xf1d9b5), 0, 0.335, 0))
    g.add(mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.04, 8), mat(0xff8fa8), 0, -0.02, 0))
    g.rotation.z = -0.3
    return g
  },
  check() {
    const g = new THREE.Group()
    const disc = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 28), mat(0x22c55e), 0, 0.18, 0)
    disc.rotation.x = Math.PI / 2
    const white = mat(0xffffff)
    const short = mesh(new THREE.BoxGeometry(0.075, 0.028, 0.01), white, -0.045, 0.16, 0.02)
    short.rotation.z = -0.8
    const long = mesh(new THREE.BoxGeometry(0.14, 0.028, 0.01), white, 0.03, 0.19, 0.02)
    long.rotation.z = 0.9
    g.add(disc, short, long)
    return g
  },
  magnifier() {
    const g = new THREE.Group()
    g.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), mat(0x8a93a3), 0, 0.06, 0))
    g.add(mesh(new THREE.TorusGeometry(0.09, 0.017, 8, 28), mat(0xe3e8f0, { metalness: 0.4, roughness: 0.4 }), 0, 0.23, 0))
    g.add(mesh(new THREE.CircleGeometry(0.085, 24), new THREE.MeshBasicMaterial({ color: 0xaae1ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }), 0, 0.23, 0))
    return g
  },
  envelope() {
    const g = new THREE.Group()
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.016), mat(0xffffff), 0, 0.15, 0))
    const line = mat(0xb9c0cc)
    const a = mesh(new THREE.BoxGeometry(0.17, 0.009, 0.004), line, -0.07, 0.2, 0.01)
    a.rotation.z = -0.6
    const b = mesh(new THREE.BoxGeometry(0.17, 0.009, 0.004), line, 0.07, 0.2, 0.01)
    b.rotation.z = 0.6
    g.add(a, b, mesh(new THREE.CircleGeometry(0.026, 14), mat(0xef4444), 0.1, 0.09, 0.01))
    return g
  },
  megaphone() {
    const g = new THREE.Group()
    const cone = mesh(new THREE.ConeGeometry(0.12, 0.26, 20, 1, true), mat(0xff5d73, { side: THREE.DoubleSide }), 0, 0.14, 0.1)
    cone.rotation.x = -Math.PI / 2
    const rim = mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 24), mat(0xffffff), 0, 0.14, 0.23)
    g.add(cone, rim, mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), mat(0xffffff), 0, 0.05, 0.02))
    return g
  },
}

function goggle(r, lidColor) {
  const g = new THREE.Group()
  const rim = mesh(new THREE.CylinderGeometry(r, r, 0.1, 28), mat(0xb9c0cc, { metalness: 0.45, roughness: 0.4 }))
  rim.rotation.x = Math.PI / 2
  const white = mesh(new THREE.CircleGeometry(r * 0.78, 28), mat(0xffffff, { emissive: 0x555555 }), 0, 0, 0.052)
  const look = new THREE.Group()
  look.position.z = 0.054
  look.add(mesh(new THREE.CircleGeometry(r * 0.42, 20), mat(0x6b4a2b)))
  look.add(mesh(new THREE.CircleGeometry(r * 0.22, 16), mat(INK), 0, 0, 0.001))
  look.add(mesh(new THREE.CircleGeometry(r * 0.09, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), -r * 0.14, r * 0.16, 0.002))
  const lid = new THREE.Group()
  lid.position.z = 0.058
  lid.add(mesh(new THREE.CircleGeometry(r * 0.8, 28), mat(lidColor)))
  lid.add(mesh(new THREE.BoxGeometry(r * 1.3, 0.014, 0.004), mat(INK), 0, -r * 0.1, 0.002))
  lid.visible = false
  g.add(rim, white, look, lid)
  g.userData = { look, lid, reach: r * 0.26 }
  return g
}

function strand(len, rz, rx = 0, x = 0, z = 0) {
  const pivot = new THREE.Group()
  pivot.position.set(x, 0, z)
  pivot.rotation.set(rx, 0, rz)
  pivot.add(mesh(new THREE.CapsuleGeometry(0.011, len, 3, 6), mat(INK), 0, len / 2, 0))
  return pivot
}

const HAIR = {
  spikes: () => [strand(0.15, 0.28, 0, -0.07), strand(0.19, 0), strand(0.15, -0.28, 0, 0.07)],
  tuft: () => [strand(0.15, 0.75), strand(0.17, 0.1, -0.2), strand(0.15, -0.75), strand(0.12, 0, 0.6)],
  parting: () => [strand(0.2, 1.2, 0, 0, 0.03), strand(0.2, -1.2, 0, 0, 0.03), strand(0.18, 0.95, 0, 0, -0.04), strand(0.18, -0.95, 0, 0, -0.04), strand(0.15, 1.3, 0.3), strand(0.15, -1.3, 0.3)],
  curl: () => {
    const s = strand(0.1, 0.1)
    const ring = mesh(new THREE.TorusGeometry(0.04, 0.011, 6, 16), mat(INK), 0.035, 0.14, 0)
    s.add(ring)
    return [s]
  },
  bald: () => [],
}

function helper(agent, bodyColor) {
  const R = 0.34
  const L = 0.55
  const BASE = 0.07
  const hip = BASE + R
  const rig = new THREE.Group()
  const outfit = mat(hex(agent.color, '#4f6bff'), { side: THREE.DoubleSide })
  const ro = R + 0.012

  rig.add(mesh(new THREE.CapsuleGeometry(R, L, 12, 28), mat(bodyColor), 0, hip + L / 2, 0))
  rig.add(mesh(new THREE.SphereGeometry(ro, 28, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), outfit, 0, hip, 0))
  rig.add(mesh(new THREE.CylinderGeometry(ro, ro, 0.2, 28, 1, true), outfit, 0, hip + 0.1, 0))
  rig.add(mesh(new THREE.CylinderGeometry(ro, ro, 0.2, 10, 1, true, -0.42, 0.84), outfit, 0, hip + 0.3, 0))
  rig.add(mesh(new THREE.CylinderGeometry(ro, ro, 0.2, 3, 1, true, 0.32, 0.12), outfit, 0, hip + 0.48, 0))
  rig.add(mesh(new THREE.CylinderGeometry(ro, ro, 0.2, 3, 1, true, -0.44, 0.12), outfit, 0, hip + 0.48, 0))
  const pocket = new THREE.Color(hex(agent.color, '#4f6bff')).multiplyScalar(0.7)
  rig.add(mesh(new THREE.CylinderGeometry(ro + 0.006, ro + 0.006, 0.09, 6, 1, true, -0.14, 0.28), mat(pocket, { side: THREE.DoubleSide }), 0, hip + 0.29, 0))

  const eyeY = hip + L - 0.02
  rig.add(mesh(new THREE.CylinderGeometry(R + 0.008, R + 0.008, 0.075, 28, 1, true), mat(INK, { side: THREE.DoubleSide }), 0, eyeY, 0))
  const eyes = []
  if (agent.eyes === 1) {
    const e = goggle(0.165, bodyColor)
    e.position.set(0, eyeY, R - 0.045)
    eyes.push(e)
  } else {
    for (const side of [-1, 1]) {
      const e = goggle(0.125, bodyColor)
      e.position.set(side * 0.135, eyeY, R - 0.062)
      e.rotation.y = side * 0.24
      eyes.push(e)
    }
  }
  rig.add(...eyes)

  const smile = mesh(new THREE.TorusGeometry(0.075, 0.013, 6, 16, Math.PI), mat(INK), 0, hip + 0.37, R - 0.004)
  smile.rotation.z = Math.PI
  rig.add(smile)

  const top = hip + L + R
  if (agent.prop === 'hardhat') {
    const yellow = mat(0xffc531)
    rig.add(mesh(new THREE.SphereGeometry(R + 0.03, 28, 12, 0, Math.PI * 2, 0, 1.25), yellow, 0, hip + L, 0))
    rig.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.03, 28), mat(0xf0a500), 0, hip + L + 0.12, 0.03))
    rig.add(mesh(new THREE.BoxGeometry(0.08, 0.05, 0.56), mat(0xffd866), 0, top + 0.02, 0))
  } else {
    const hair = new THREE.Group()
    hair.position.y = top - 0.01
    hair.add(...HAIR[agent.hair]())
    rig.add(hair)
  }

  const armL = arm(-(R - 0.01), hip + 0.36, INK)
  const armR = arm(R - 0.01, hip + 0.36, INK)
  const held = new THREE.Group()
  held.position.y = -0.42
  const prop = PROPS[agent.prop] ? PROPS[agent.prop]() : null
  const cup = mug()
  cup.visible = false
  held.add(cup)
  if (prop) held.add(prop)
  armR.add(held)
  const legL = foot(-0.13)
  const legR = foot(0.13)
  rig.add(armL, armR, legL, legR)

  return {
    rig, armL, armR, legL, legR, held, prop, cup, rays: null, top: top + 0.1,
    look(x, y) {
      for (const e of eyes) e.userData.look.position.set(x * e.userData.reach, y * e.userData.reach, 0.054)
    },
    shut(closed) {
      for (const e of eyes) e.userData.lid.visible = closed
    },
  }
}

function claude() {
  const C = 0xd97757
  const rig = new THREE.Group()
  const suit = mat(0x2b2a27)
  rig.add(mesh(new THREE.CapsuleGeometry(0.3, 0.42, 10, 24), suit, 0, 0.58, 0))
  rig.add(mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.24, 8, 1, true, -0.3, 0.6), mat(0xf4efe6, { side: THREE.DoubleSide }), 0, 0.7, 0))
  rig.add(mesh(new THREE.BoxGeometry(0.075, 0.2, 0.02), mat(C), 0, 0.67, 0.305))
  rig.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.03), mat(C), 0, 0.79, 0.3))

  const head = new THREE.Group()
  head.position.y = 1.22
  head.add(mesh(new THREE.SphereGeometry(0.27, 28, 20), mat(C)))
  const rays = new THREE.Group()
  const rayMat = mat(C)
  const N = 30
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N
    const r = Math.sqrt(1 - y * y)
    const a = i * 2.399963
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)
    if (dir.z > 0.6 || dir.y < -0.75) continue
    const len = i % 2 ? 0.2 : 0.3
    const ray = mesh(new THREE.CapsuleGeometry(0.05, len, 4, 10), rayMat)
    ray.position.copy(dir).multiplyScalar(0.24 + len / 2)
    ray.quaternion.setFromUnitVectors(UP, dir)
    rays.add(ray)
  }
  head.add(rays)

  const face = new THREE.Group()
  const eyes = []
  for (const side of [-1, 1]) {
    const e = mesh(new THREE.SphereGeometry(0.04, 14, 12), mat(INK), side * 0.095, 0.03, 0.25)
    e.scale.set(0.75, 1.3, 0.5)
    eyes.push(e)
    face.add(e)
  }
  const smile = mesh(new THREE.TorusGeometry(0.065, 0.012, 6, 16, Math.PI), mat(INK), 0, -0.07, 0.262)
  smile.rotation.z = Math.PI
  face.add(smile)
  head.add(face)
  rig.add(head)

  const armL = arm(-0.29, 0.86, C)
  const armR = arm(0.29, 0.86, C)
  const held = new THREE.Group()
  held.position.y = -0.42
  const cup = mug()
  cup.visible = false
  held.add(cup)
  armR.add(held)
  const legL = foot(-0.12)
  const legR = foot(0.12)
  rig.add(armL, armR, legL, legR)
  rig.scale.setScalar(1.12)

  return {
    rig, armL, armR, legL, legR, held, prop: null, cup, rays, top: 1.9,
    look(x, y) {
      face.position.set(x * 0.02, y * 0.015, 0)
    },
    shut(closed) {
      for (const e of eyes) e.scale.y = closed ? 0.2 : 1.3
    },
  }
}

export function makeCharacter(agent, bodyColor) {
  const c = agent.avatar === 'claude' ? claude() : helper(agent, bodyColor)
  const group = new THREE.Group()
  group.add(c.rig)
  return { group, ...c }
}
