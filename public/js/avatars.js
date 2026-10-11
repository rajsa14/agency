// Draws the staff. Helpers are little capsule people with goggles; the CEO is the sunburst one.
;(() => {
  const INK = '#1b1a1f'
  const BODIES = ['#8fe3c3', '#c8b6ff', '#ffadc9', '#8fd3ff', '#ffc59e', '#d3ec8c']
  let uid = 0

  const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback)

  const shade = (c, amount) => {
    const n = parseInt(c.slice(1), 16)
    const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * amount)))
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`
  }

  const eye = (cx, cy, r) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#b9c0cc"/>
    <circle cx="${cx}" cy="${cy}" r="${r - 1.5}" fill="none" stroke="#8a93a3" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="#fff"/>
    <g class="look">
      <circle cx="${cx}" cy="${cy}" r="${r * 0.38}" fill="#6b4a2b"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 0.19}" fill="${INK}"/>
      <circle cx="${cx - r * 0.14}" cy="${cy - r * 0.16}" r="${r * 0.09}" fill="#fff"/>
    </g>`

  const HAIR = {
    spikes: `<path d="M50 21 46 8M60 18V5M70 21 74 8"/>`,
    tuft: `<path d="M60 18Q56 6 47 7M60 18Q60 5 63 3M60 18Q66 8 74 9"/>`,
    parting: `<path d="M60 19Q49 16 41 27M60 19Q71 16 79 27M60 19Q53 13 45 19M60 19Q67 13 75 19"/>`,
    curl: `<path d="M60 18Q59 6 67 5Q75 5 73 12Q71 16 67 12"/>`,
    bald: '',
  }

  const PROPS = {
    clipboard: `<rect x="-10" y="-25" width="20" height="26" rx="2.5" fill="#c79a5b"/><rect x="-7.5" y="-21" width="15" height="20" rx="1" fill="#fff"/><rect x="-4" y="-27" width="8" height="5" rx="1.5" fill="#8a93a3"/><path d="M-4.5-15h9M-4.5-10h9M-4.5-5h5" stroke="#b9c0cc" stroke-width="1.6" stroke-linecap="round"/>`,
    pencil: `<g transform="rotate(18)"><rect x="-3.2" y="-28" width="6.4" height="26" fill="#ffb347"/><rect x="-3.2" y="-33" width="6.4" height="5" rx="1.5" fill="#ff8fa8"/><path d="M-3.2-2h6.4L0 5z" fill="#f1d9b5"/><path d="M-1.2 2.4h2.4L0 5z" fill="${INK}"/></g>`,
    check: `<circle cy="-14" r="13" fill="#22c55e"/><path d="M-6-14l4.4 4.4L6.5-19" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    magnifier: `<path d="M0-6V3" stroke="#8a93a3" stroke-width="4.5" stroke-linecap="round"/><circle cy="-17" r="10" fill="rgba(170,225,255,.4)" stroke="#e3e8f0" stroke-width="3.5"/><path d="M-5-20a6 6 0 0 1 5-3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
    envelope: `<rect x="-14" y="-24" width="28" height="20" rx="2.5" fill="#fff"/><path d="M-13-23 0-12 13-23" fill="none" stroke="#b9c0cc" stroke-width="1.8" stroke-linejoin="round"/><circle cx="9" cy="-9" r="3.2" fill="#ef4444"/>`,
    megaphone: `<g transform="rotate(-14)"><path d="M-8-16v8l16 8v-24z" fill="#ff5d73"/><rect x="-13" y="-16" width="6" height="8" rx="2" fill="#fff"/><rect x="8" y="-25" width="3.5" height="26" rx="1.75" fill="#fff"/><path d="M15-17q3 5 0 10M19-20q5 8 0 16" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".7"/></g>`,
    hardhat: '',
    none: '',
  }

  function helper(agent, tint) {
    const id = `av${++uid}`
    const body = BODIES[tint % BODIES.length]
    const outfit = hex(agent.color, '#4f6bff')
    const hat = agent.prop === 'hardhat'
    const eyes = agent.eyes === 1 ? eye(60, 52, 19) : eye(46, 52, 15) + eye(74, 52, 15)
    const armUp = PROPS[agent.prop] ? `<path d="M88 86Q103 84 102 68"/>` : `<path d="M88 86Q104 94 101 112"/>`
    const hand = PROPS[agent.prop] ? [102, 66] : [101, 113]
    return `<svg viewBox="0 0 120 150" class="avatar helper" aria-hidden="true">
      <g fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"><path d="M32 86Q15 94 19 112"/>${armUp}</g>
      <clipPath id="${id}"><rect x="28" y="18" width="64" height="118" rx="32"/></clipPath>
      <rect x="28" y="18" width="64" height="118" rx="32" fill="${body}"/>
      <g clip-path="url(#${id})">
        <path d="M28 18h14v118H28z" fill="#fff" opacity=".16"/>
        <path d="M28 104h64v34H28zM43 90h34v16H43z" fill="${outfit}"/>
        <path d="M27 82 45 93M93 82 75 93" stroke="${outfit}" stroke-width="6"/>
        <rect x="53" y="97" width="14" height="10" rx="2.5" fill="${shade(outfit, 0.72)}"/>
        <rect x="28" y="47" width="64" height="10" fill="${INK}"/>
      </g>
      <circle cx="45" cy="92.500" r="2.2" fill="#fff" opacity=".85"/><circle cx="75" cy="92.500" r="2.2" fill="#fff" opacity=".85"/>
      ${eyes}
      <path d="M50 77Q60 86 70 77" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      ${hat
        ? `<path d="M30 30a30 22 0 0 1 60 0z" fill="#ffc531"/><rect x="25" y="28" width="70" height="6" rx="3" fill="#f0a500"/><rect x="56" y="9" width="8" height="20" rx="3" fill="#ffd866"/>`
        : `<g fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round">${HAIR[agent.hair] || ''}</g>`}
      <rect x="43" y="134" width="12" height="13" rx="4" fill="${INK}"/><rect x="65" y="134" width="12" height="13" rx="4" fill="${INK}"/>
      <circle cx="19" cy="113" r="6" fill="${INK}"/><circle cx="${hand[0]}" cy="${hand[1]}" r="6" fill="${INK}"/>
      <g class="prop" transform="translate(${hand[0]} ${hand[1] - 3})">${PROPS[agent.prop] || ''}</g>
    </svg>`
  }

  function claude() {
    const C = '#d97757'
    let rays = ''
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6 + 0.26
      const len = i % 2 ? 35 : 42
      rays += `M${(60 + Math.cos(a) * 16).toFixed(1)} ${(48 + Math.sin(a) * 16).toFixed(1)}L${(60 + Math.cos(a) * len).toFixed(1)} ${(48 + Math.sin(a) * len).toFixed(1)}`
    }
    return `<svg viewBox="0 0 120 150" class="avatar claude" aria-hidden="true">
      <g fill="none" stroke="#2b2a27" stroke-width="8" stroke-linecap="round"><path d="M38 100Q22 106 22 122M82 100Q98 106 98 122"/></g>
      <circle cx="22" cy="124" r="6.5" fill="${C}"/><circle cx="98" cy="124" r="6.5" fill="${C}"/>
      <rect x="34" y="88" width="52" height="54" rx="17" fill="#2b2a27"/>
      <path d="M50 88h20l-10 20z" fill="#f4efe6"/>
      <path d="M57 91h6l2.500 21-5.500 6-5.500-6z" fill="${C}"/>
      <rect x="44" y="136" width="12" height="11" rx="4" fill="#1b1a1f"/><rect x="64" y="136" width="12" height="11" rx="4" fill="#1b1a1f"/>
      <path class="rays" d="${rays}" fill="none" stroke="${C}" stroke-width="9" stroke-linecap="round"/>
      <circle cx="60" cy="48" r="22" fill="${C}"/>
      <g class="look"><ellipse cx="52.500" cy="46" rx="2.700" ry="4.300" fill="#1b1a1f"/><ellipse cx="67.500" cy="46" rx="2.700" ry="4.300" fill="#1b1a1f"/></g>
      <path d="M53 56Q60 62 67 56" fill="none" stroke="#1b1a1f" stroke-width="2.400" stroke-linecap="round"/>
    </svg>`
  }

  window.avatarSVG = (agent, tint = 0) => (agent.avatar === 'claude' ? claude() : helper(agent, tint))
})()
