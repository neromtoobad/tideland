// Isometric canvas renderer. Pure drawing: it reads the world model and never touches Arkiv.
import { SIZE, lifeLeft, BLOCK_SECONDS, MATERIALS, COMMONS } from "../../shared/tideland.js"

const TW = 96, TH = 48 // tile diamond at zoom 1
const POSES = ["", "-hungry", "-sleepy", "-sleeping", "-eating", "-waving"]
const DECOR = ["deco-palm", "deco-pines", "deco-rocks", "deco-flowers", "deco-grass", "deco-bench", "boat-row", "boat-sail"]
const SPRITES = ["driftwood", "pine", "stone", "monument", "lighthouse", "plot", "inscription", "buoy", "jetty", "seawall", "stew", ...DECOR,
  ...["carpenter", "mason", "lamplighter"].flatMap((l) => POSES.map((p) => l + p)),
  "carpenter", "carpenter-sad", "mason", "mason-sad", "lamplighter", "lamplighter-sad"]
const img = {}
export const spriteUrl = (n) => `/sprites/${n}.webp`
export function loadSprites() {
  return Promise.all(SPRITES.map((n) => new Promise((res) => {
    const i = new Image(); i.onload = () => res(); i.onerror = () => res(); i.src = spriteUrl(n); img[n] = i
  })))
}

// Guild look: which villager stands for which guild colour.
const CHARACTER_BY_COLOR = { "#1F6E68": "carpenter", "#B4552E": "mason", "#96762B": "lamplighter" }
export const characterFor = (guild) => (guild && CHARACTER_BY_COLOR[guild.data?.color?.toUpperCase?.()]) || null

export function createView(canvas) {
  const ctx = canvas.getContext("2d")
  const view = { canvas, ctx, zoom: 1, ox: 0, oy: 0, dpr: 1, hover: null, selected: null, t0: performance.now() }

  view.resize = () => {
    view.dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.floor(innerWidth * view.dpr)
    canvas.height = Math.floor(innerHeight * view.dpr)
  }
  view.fit = () => {
    const w = SIZE * TW, h = SIZE * TH
    view.zoom = Math.min(innerWidth / (w * 1.05), innerHeight / (h * 1.25), 1.4)
    view.ox = innerWidth / 2
    view.oy = innerHeight / 2 - (h * view.zoom) / 2 + 20
  }
  // grid -> screen (CSS px), at the tile's top vertex
  view.toScreen = (x, y) => ({ sx: view.ox + (x - y) * (TW / 2) * view.zoom, sy: view.oy + (x + y) * (TH / 2) * view.zoom })
  view.toGrid = (px, py) => {
    const a = (px - view.ox) / ((TW / 2) * view.zoom), b = (py - view.oy) / ((TH / 2) * view.zoom)
    const x = Math.floor((a + b) / 2), y = Math.floor((b - a) / 2)
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null
  }
  view.focus = (x, y) => {
    const z = Math.max(view.zoom, 1.1)
    view.zoom = z
    view.ox = innerWidth / 2 - (x - y) * (TW / 2) * z
    view.oy = innerHeight / 2 - (x + y + 1) * (TH / 2) * z
  }
  view.splashes = []
  view.splash = (t) => { if (t.x !== undefined) view.splashes.push({ x: t.x, y: t.y, at: performance.now() }) }
  view.resize(); view.fit()
  return view
}

function diamond(ctx, sx, sy, w, h) {
  ctx.beginPath()
  ctx.moveTo(sx, sy); ctx.lineTo(sx + w / 2, sy + h / 2); ctx.lineTo(sx, sy + h); ctx.lineTo(sx - w / 2, sy + h / 2); ctx.closePath()
}

/** Draws one frame. `world` = { cells, guilds(Map key->guild), head (bigint, estimated), headAt (ms) } */
export function draw(view, world) {
  const { ctx, dpr, zoom } = view
  const now = performance.now(), t = (now - view.t0) / 1000
  const head = world.head + BigInt(Math.floor((Date.now() - world.headAt) / 1000 / BLOCK_SECONDS))
  const run = view.run
  if (run) followCamera(view, run)
  const scene = world.scene
  if (scene && !run) followMe(view, scene.me)
  const w = TW * view.zoom, h = TH * view.zoom
  const shake = run ? run.shake : 0
  ctx.setTransform(dpr, 0, 0, dpr, (Math.random() - 0.5) * shake * dpr, (Math.random() - 0.5) * shake * dpr)

  // sea
  const g = ctx.createLinearGradient(0, 0, 0, innerHeight)
  g.addColorStop(0, "#d6e8e4"); g.addColorStop(1, "#a9cbc5")
  ctx.fillStyle = g; ctx.fillRect(0, 0, innerWidth, innerHeight)
  ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.2
  for (let i = 0; i < 26; i++) {
    const yy = ((i * 53 + t * 9) % (innerHeight + 60)) - 30
    const xx = ((i * 197) % innerWidth)
    ctx.beginPath(); ctx.moveTo(xx - 26, yy); ctx.quadraticCurveTo(xx, yy - 5, xx + 26, yy); ctx.stroke()
  }

  // island slab edge (gives the coast thickness)
  const top = view.toScreen(0, 0), right = view.toScreen(SIZE, 0), bottom = view.toScreen(SIZE, SIZE), left = view.toScreen(0, SIZE)
  const lip = 14 * zoom
  ctx.fillStyle = "#cdbf9c"
  ctx.beginPath(); ctx.moveTo(left.sx, left.sy); ctx.lineTo(bottom.sx, bottom.sy); ctx.lineTo(right.sx, right.sy)
  ctx.lineTo(right.sx, right.sy + lip); ctx.lineTo(bottom.sx, bottom.sy + lip); ctx.lineTo(left.sx, left.sy + lip); ctx.closePath(); ctx.fill()
  // foam
  ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.25 * Math.sin(t * 1.3)})`; ctx.lineWidth = 3 * zoom
  ctx.beginPath(); ctx.moveTo(left.sx - 6 * zoom, left.sy + lip + 4 * zoom); ctx.lineTo(bottom.sx, bottom.sy + lip + 7 * zoom); ctx.lineTo(right.sx + 6 * zoom, right.sy + lip + 4 * zoom); ctx.stroke()

  // ground tiles
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const { sx, sy } = view.toScreen(x, y)
    if (sx < -w || sx > innerWidth + w || sy < -h * 2 || sy > innerHeight + h) continue
    const shade = (x * 7 + y * 13) % 5
    ctx.fillStyle = isSand(x, y) ? ["#ece3cb", "#e9dfc4", "#eee6d0", "#e6dcbf", "#ebe2c8"][shade] : ["#d3e0b4", "#cddbad", "#d7e3ba", "#c9d8a8", "#d0deb1"][shade]
    diamond(ctx, sx, sy, w, h); ctx.fill()
  }

  // depth-sorted objects
  const order = ALL_CELLS
  const actors = [], islanders = []
  for (const [cx, cy] of order) {
    const { sx, sy } = view.toScreen(cx, cy)
    if (sx < -w * 2 || sx > innerWidth + w * 2 || sy < -h * 6 || sy > innerHeight + h * 2) continue
    const c = world.cells.get(`${cx}:${cy}`)
    if (!c || (!c.structure && !c.parcel && !c.inscriptions.length)) { drawDecor(ctx, cx, cy, sx, sy, w, h, t); if (!c) continue }
    const s = c.structure
    if (s) {
      drawThing(ctx, s.material, s, head, sx, sy, w, h, t)
      if (s.material === "lighthouse" && s.expiresAt > head) drawBeam(ctx, s, head, sx, sy, w, t)
      if (s.kind === "home") islanders.push({ c, s, mood: world.moods.get(s.key) ?? "happy" })
      const guild = world.guilds.get(s.guild)
      const ch = characterFor(guild)
      if (ch) actors.push({ c, s, ch })
    } else if (c.parcel) {
      drawThing(ctx, "plot", c.parcel, head, sx, sy, w, h, t)
    } else if (c.inscriptions.length) {
      drawThing(ctx, "inscription", c.inscriptions[0], head, sx, sy, w, h, t)
    }
    if (c.contested?.length || c.squatters?.length) {
      ctx.fillStyle = "#b4552e"; ctx.beginPath(); ctx.arc(sx + w * 0.32, sy + h * 0.2, 5 * zoom, 0, Math.PI * 2); ctx.fill()
    }
  }

  // villagers: one beside each guild house; sad when it sinks within a day
  const DAY = 43200n
  const shown = zoom < 0.45 || view.run ? [] : actors.filter((a) => a.s.expiresAt - head < DAY || parseInt(a.s.key.slice(-2), 16) % 3 === 0)
  for (const a of shown) {
    const sad = a.s.expiresAt - head < DAY
    const sprite = img[`${a.ch}${sad ? "-sad" : ""}`]
    if (!sprite?.complete) continue
    const { sx, sy } = view.toScreen(a.c.x, a.c.y)
    const cw = w * 0.34, chh = cw * (sprite.naturalHeight / sprite.naturalWidth)
    const bob = sad ? 0 : Math.sin(t * 3 + a.c.x) * 1.5 * zoom
    ctx.drawImage(sprite, sx + w * 0.14, sy + h * 0.95 - chh + bob, cw, chh)
  }

  if (run) drawRunLayer(view, world, run, head, w, h, t, now)
  if (scene && !run) drawWalkers(view, scene, w, h, t)

  drawBoats(view, w, h, t)
  drawSky(view, world, head, w, h, t)

  // splashes: rings where something just went under
  view.splashes = view.splashes.filter((p) => now - p.at < 3500)
  for (const p of view.splashes) {
    const k = (now - p.at) / 3500, { sx, sy } = view.toScreen(p.x, p.y)
    for (const off of [0, 0.25, 0.5]) {
      const q = k - off; if (q <= 0) continue
      ctx.strokeStyle = `rgba(255,255,255,${(1 - q) * 0.9})`; ctx.lineWidth = 2.5 * zoom
      ctx.beginPath(); ctx.ellipse(sx, sy + h / 2, w * (0.2 + q * 0.7), h * (0.2 + q * 0.7), 0, 0, Math.PI * 2); ctx.stroke()
    }
  }

  // islanders: each one beside their home, pose and bubble from their needs, pottering about a little
  const walking = new Set(scene ? [scene.me.home?.key, ...scene.others.map((o) => o.home)] : [])
  if (zoom >= 0.45 && !view.run) {
    const BUBBLE = { hungry: "🍲", sleepy: "💤", sad: "💧", sleeping: "💤", eating: "😋", waving: "👋" }
    for (const { c, s, mood } of islanders) {
      if (walking.has(s.key)) continue // out and about: drawn where they actually are
      const suffix = { happy: "", hungry: "-hungry", sleepy: "-sleepy", sad: "-sad", sleeping: "-sleeping", eating: "-eating", waving: "-waving" }[mood] ?? ""
      const sprite = img[`${s.look || "carpenter"}${suffix}`]
      if (!sprite?.complete || !sprite.naturalWidth) continue
      const seed = parseInt(s.key.slice(-4), 16)
      const still = mood === "sleeping" || mood === "eating" || mood === "sad"
      const wx = still ? 0.55 : 0.55 + 0.25 * Math.sin(t * 0.35 + seed), wy = still ? 0.9 : 0.9 + 0.2 * Math.cos(t * 0.3 + seed)
      const { sx, sy } = view.toScreen(c.x + wx, c.y + wy)
      const cw = w * (mood === "sleeping" ? 0.5 : 0.36), chh = cw * (sprite.naturalHeight / sprite.naturalWidth)
      const hop = still ? 0 : Math.abs(Math.sin(t * 4 + seed)) * 2 * zoom
      ctx.drawImage(sprite, sx - cw / 2, sy - chh - hop, cw, chh)
      const b = BUBBLE[mood]
      if (b) {
        const bx = sx + cw * 0.35, by = sy - chh - 6 * zoom, r = 9 * zoom
        ctx.fillStyle = "rgba(251,252,250,.95)"; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = "rgba(27,43,42,.15)"; ctx.lineWidth = 1; ctx.stroke()
        ctx.font = `${Math.round(11 * zoom)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(b, bx, by + 0.5)
      }
    }
  }

  // hover / selection outlines
  for (const [cell, color, width] of [[view.hover, "rgba(31,110,104,.55)", 2], [view.selected, "#1f6e68", 3]]) {
    if (!cell) continue
    const { sx, sy } = view.toScreen(cell.x, cell.y)
    ctx.strokeStyle = color; ctx.lineWidth = width; diamond(ctx, sx, sy, w, h); ctx.stroke()
  }
}

function drawThing(ctx, name, thing, head, sx, sy, w, h, t) {
  const sprite = img[name]
  if (!sprite?.complete || !sprite.naturalWidth) return
  const left = Number(thing.expiresAt - head) // blocks
  const frac = lifeLeft(thing, head)
  const sw = w * 1.02, sh = sw * (sprite.naturalHeight / sprite.naturalWidth)
  // the trimmed sprite's bottom edge is the tile slab's bottom vertex; the slab is ~9% of width deep
  let bx = sx - sw / 2, by = sy + h + sw * 0.09 - sh
  // the last stretch of its life (6 h, or a third of a short life): it settles and the water rises around it
  const span = Number(thing.material && MATERIALS[thing.material] ? MATERIALS[thing.material].seconds / BLOCK_SECONDS : 302400)
  const window_ = Math.min(10800, span * 0.3)
  const sinking = left < window_ ? 1 - Math.max(0, left) / window_ : 0
  by += sinking * sh * 0.28
  ctx.save()
  if (frac < 0.35) ctx.filter = `saturate(${0.45 + frac}) sepia(${0.15 + (0.35 - frac)})`
  if (sinking > 0) {
    ctx.beginPath(); ctx.rect(bx - 4, by - 4, sw + 8, (sy + h * 0.98) - by + 4 + sinking * sh * 0.05); ctx.clip()
  }
  ctx.globalAlpha = left <= 0 ? 0.25 : 1
  ctx.drawImage(sprite, bx, by, sw, sh)
  ctx.restore()
  if (sinking > 0) {
    ctx.save()
    ctx.fillStyle = `rgba(122,178,170,${0.35 + 0.35 * sinking})`
    diamond(ctx, sx, sy + h * (0.2 - 0.15 * sinking), w * (0.86 + 0.1 * sinking), h * (0.86 + 0.1 * sinking)); ctx.fill()
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.3 * Math.sin(t * 4 + sx)})`; ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }
}

function drawBeam(ctx, s, head, sx, sy, w, t) {
  const left = Number(s.expiresAt - head)
  const flicker = left < 21600 ? (Math.sin(t * 17) > 0.2 ? 1 : 0.25) : 1
  const ang = t * 0.9
  const lx = sx, ly = sy - w * 0.62
  ctx.save()
  ctx.globalCompositeOperation = "lighter"
  const grad = ctx.createRadialGradient(lx, ly, 2, lx, ly, w * 1.15)
  grad.addColorStop(0, `rgba(255,214,140,${0.32 * flicker})`); grad.addColorStop(1, "rgba(255,214,140,0)")
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.moveTo(lx, ly)
  ctx.arc(lx, ly, w * 1.15, ang - 0.22, ang + 0.22); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.arc(lx, ly, w * 0.12, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

// ---------------- Keeper Run layer ----------------

function followCamera(view, run) {
  const zt = innerWidth < 760 ? 1.15 : 1.55
  view.zoom += (zt - view.zoom) * 0.06
  const tx = innerWidth / 2 - (run.pos.x - run.pos.y) * (TW / 2) * view.zoom
  const ty = innerHeight * 0.56 - (run.pos.x + run.pos.y) * (TH / 2) * view.zoom
  view.ox += (tx - view.ox) * 0.1; view.oy += (ty - view.oy) * 0.1
}

function drawRunLayer(view, world, run, head, w, h, t, now) {
  const { ctx } = view
  // storm surges: a foam front rolling in from the open sea (the far x / y edges)
  for (const wave of run.waves) {
    const p = (now - wave.at) / 2600, k = 64 - p * 30 // diagonal x + y = k
    const a = view.toScreen(Math.min(32, k), Math.max(0, k - 32)), b = view.toScreen(Math.max(0, k - 32), Math.min(32, k))
    ctx.save()
    ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, p)) * 0.9
    ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 7 * view.zoom; ctx.lineCap = "round"
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
    ctx.strokeStyle = "rgba(127,183,174,.5)"; ctx.lineWidth = 22 * view.zoom
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy + 12 * view.zoom); ctx.lineTo(b.sx, b.sy + 12 * view.zoom); ctx.stroke()
    ctx.restore()
  }

  // ring timers over every live commons: the real remaining life, optimistic while a patch is sealing
  for (const c of world.cells.values()) {
    const s = c.structure
    if (!s || s.kind !== "structure" || !COMMONS.includes(s.material)) continue
    const exp = run.optimistic.get(s.key) > s.expiresAt ? run.optimistic.get(s.key) : s.expiresAt
    if (exp <= head) continue
    const span = Number(MATERIALS[s.material].seconds / BLOCK_SECONDS), left = Number(exp - head), frac = Math.min(1, left / span)
    const { sx, sy } = view.toScreen(s.x, s.y)
    const cx = sx, cy = sy - h * 1.15, r = 13 * view.zoom
    const col = frac < 0.12 ? "#b4552e" : frac < 0.4 ? "#c9922e" : "#1f6e68"
    const pulse = frac < 0.12 ? 1 + 0.12 * Math.sin(t * 10) : 1
    ctx.save()
    ctx.fillStyle = "rgba(251,252,250,.92)"; ctx.beginPath(); ctx.arc(cx, cy, r * 1.25 * pulse, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = "rgba(27,43,42,.12)"; ctx.lineWidth = 4 * view.zoom; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke()
    const mins = left * BLOCK_SECONDS / 60
    ctx.fillStyle = col; ctx.font = `600 ${Math.round(9.5 * view.zoom)}px "IBM Plex Mono", monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"
    ctx.fillText(mins < 60 ? `${Math.ceil(mins)}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`, cx, cy + 0.5)
    if (s.key === run.target) { ctx.strokeStyle = "#1f6e68"; ctx.lineWidth = 2.5; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
    ctx.restore()
  }

  // the keeper
  const sad = now < run.sadUntil
  const sprite = img[`${run.keeper}${sad ? "-sad" : ""}`]
  if (sprite?.complete) {
    const { sx, sy } = view.toScreen(run.pos.x, run.pos.y)
    const cw = w * 0.6, chh = cw * (sprite.naturalHeight / sprite.naturalWidth)
    const moving = !!run.goal || Object.values(run.keys).some(Boolean)
    const hop = moving ? Math.abs(Math.sin(t * 14)) * 6 * view.zoom : 0
    const squash = run.patchingNow ? 1 - 0.08 * Math.abs(Math.sin(t * 30)) : 1
    ctx.save()
    ctx.fillStyle = "rgba(27,43,42,.18)"; ctx.beginPath(); ctx.ellipse(sx, sy + h * 0.5, cw * 0.35, cw * 0.12, 0, 0, Math.PI * 2); ctx.fill()
    ctx.translate(sx, sy + h * 0.5 - hop); ctx.scale(run.facing < 0 ? -1 : 1, squash)
    ctx.drawImage(sprite, -cw / 2, -chh, cw, chh)
    ctx.restore()
  }

  // particles and floating numbers
  for (const p of run.particles) {
    const a = view.toScreen(p.gx, p.gy)
    ctx.fillStyle = p.color; ctx.globalAlpha = 1 - (now - p.at) / 700
    ctx.fillRect(a.sx + p.x, a.sy + p.y, p.r, p.r); ctx.globalAlpha = 1
  }
  for (const f of run.floaters) {
    const k = (now - f.at) / (1100 * f.life), a = view.toScreen(f.gx, f.gy)
    ctx.save(); ctx.globalAlpha = 1 - k
    ctx.font = `700 ${Math.round((f.text === "CLUTCH" ? 20 : 15) * Math.min(1.4, view.zoom))}px "Albert Sans", sans-serif`; ctx.textAlign = "center"
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(251,252,250,.95)"; ctx.strokeText(f.text, a.sx + f.dx, a.sy + f.dy - k * 40)
    ctx.fillStyle = f.color; ctx.fillText(f.text, a.sx + f.dx, a.sy + f.dy - k * 40); ctx.restore()
  }

  // danger compass: arrows at the screen edge toward commons about to go under
  for (const c of world.cells.values()) {
    const s = c.structure
    if (!s || s.kind !== "structure" || !COMMONS.includes(s.material)) continue
    const exp = run.optimistic.get(s.key) > s.expiresAt ? run.optimistic.get(s.key) : s.expiresAt
    const frac = Number(exp - head) / Number(MATERIALS[s.material].seconds / BLOCK_SECONDS)
    if (exp <= head || frac > 0.15) continue
    const { sx, sy } = view.toScreen(s.x + 0.5, s.y + 0.5)
    if (sx > 40 && sx < innerWidth - 40 && sy > 90 && sy < innerHeight - 40) continue
    const cx = innerWidth / 2, cy = innerHeight / 2, ang = Math.atan2(sy - cy, sx - cx)
    const ex = Math.max(28, Math.min(innerWidth - 28, cx + Math.cos(ang) * innerWidth)), ey = Math.max(96, Math.min(innerHeight - 28, cy + Math.sin(ang) * innerHeight))
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang)
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 8)
    ctx.fillStyle = "#b4552e"; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  // opening banner
  if (run.banner && now - run.banner < 2200) {
    const k = (now - run.banner) / 2200
    ctx.save(); ctx.globalAlpha = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1
    ctx.textAlign = "center"; ctx.fillStyle = "#1b2b2a"
    ctx.font = `400 ${Math.min(64, innerWidth / 9)}px "Instrument Serif", serif`; ctx.fillText("Storm shift", innerWidth / 2, innerHeight * 0.32)
    ctx.font = `600 15px "IBM Plex Mono", monospace`; ctx.fillStyle = "#b4552e"; ctx.fillText("keep the commons afloat", innerWidth / 2, innerHeight * 0.32 + 30)
    ctx.restore()
  }

  // storm light: a cool tint and rain
  ctx.save()
  ctx.fillStyle = "rgba(31,58,72,.10)"; ctx.fillRect(0, 0, innerWidth, innerHeight)
  ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1
  for (let i = 0; i < 90; i++) {
    const x = ((i * 137 + t * 380) % (innerWidth + 200)) - 100, y = ((i * 89 + t * 900) % (innerHeight + 60)) - 30
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 16); ctx.stroke()
  }
  ctx.restore()
}

// ---------------- Play mode: islanders walking about ----------------

function followMe(view, me) {
  const zt = innerWidth < 760 ? 1.3 : 1.75
  view.zoom += (zt - view.zoom) * 0.05
  const tx = innerWidth / 2 - (me.pos.x - me.pos.y) * (TW / 2) * view.zoom
  const ty = innerHeight * 0.58 - (me.pos.x + me.pos.y) * (TH / 2) * view.zoom
  view.ox += (tx - view.ox) * 0.08; view.oy += (ty - view.oy) * 0.08
}

const SUFFIX = { happy: "", hungry: "-hungry", sleepy: "-sleepy", sad: "-sad", sleeping: "-sleeping", eating: "-eating", waving: "-waving" }

function drawWalkers(view, scene, w, h, t) {
  const { ctx } = view
  // the next thing to do: a bouncing pin where to go
  if (scene.target) {
    const { sx, sy } = view.toScreen(scene.target.x, scene.target.y)
    const bob = Math.abs(Math.sin(t * 3)) * 10 * view.zoom, py = sy - h * 1.5 - bob
    ctx.save()
    ctx.fillStyle = "rgba(31,110,104,.18)"; ctx.beginPath(); ctx.ellipse(sx, sy, w * 0.35 * (1 - bob / 40), h * 0.3 * (1 - bob / 40), 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "#1f6e68"; ctx.beginPath(); ctx.arc(sx, py, 13 * view.zoom, Math.PI, 0); ctx.lineTo(sx, py + 22 * view.zoom); ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(sx, py, 5 * view.zoom, 0, Math.PI * 2); ctx.fill()
    ctx.font = `700 ${Math.round(11 * view.zoom)}px "Albert Sans", sans-serif`; ctx.textAlign = "center"
    const lw = ctx.measureText(scene.target.label).width + 14
    ctx.fillStyle = "#1f6e68"; roundRect(ctx, sx - lw / 2, py - 36 * view.zoom, lw, 18 * view.zoom, 9 * view.zoom); ctx.fill()
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(scene.target.label, sx, py - 27 * view.zoom)
    ctx.restore()
  }
  const all = [...scene.others.map((o) => ({ ...o, mine: false })), { home: scene.me.home?.key, look: scene.me.home?.look, name: scene.me.name, pos: scene.me.pos, mood: scene.me.mood, facing: scene.me.facing, moving: scene.me.moving, mine: true, fishing: !!scene.me.fishing }]
  all.sort((a, b) => (a.pos.x + a.pos.y) - (b.pos.x + b.pos.y))
  for (const a of all) {
    const moving = a.mine ? a.moving : a.pos.moving
    const mood = moving ? "happy" : a.mood || "happy"
    const sprite = img[`${a.look || "carpenter"}${SUFFIX[mood] ?? ""}`] || img[a.look || "carpenter"]
    if (!sprite?.complete || !sprite.naturalWidth) continue
    const { sx, sy } = view.toScreen(a.pos.x, a.pos.y)
    const cw = w * (a.mine ? 0.64 : 0.54), chh = cw * (sprite.naturalHeight / sprite.naturalWidth)
    const hop = moving ? Math.abs(Math.sin(t * 11 + (a.pos.x || 0))) * 5 * view.zoom : 0
    ctx.save()
    ctx.fillStyle = "rgba(27,43,42,.2)"; ctx.beginPath(); ctx.ellipse(sx, sy, cw * 0.3, cw * 0.1, 0, 0, Math.PI * 2); ctx.fill()
    if (a.mine) { ctx.strokeStyle = "rgba(31,110,104,.55)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy, cw * 0.42, cw * 0.15, 0, 0, Math.PI * 2); ctx.stroke() }
    ctx.translate(sx, sy - hop); ctx.scale(((a.mine ? a.facing : a.pos.facing) ?? 1) < 0 ? -1 : 1, 1)
    ctx.drawImage(sprite, -cw / 2, -chh, cw, chh)
    ctx.restore()
    // name tag: you always; others only when they're near you, to keep the screen calm
    const near = a.mine || Math.hypot(a.pos.x - scene.me.pos.x, a.pos.y - scene.me.pos.y) < 6
    if (a.name && near) {
      ctx.save()
      ctx.font = `600 ${Math.round(10.5 * Math.min(1.3, view.zoom))}px "Albert Sans", sans-serif`; ctx.textAlign = "center"
      const tw = ctx.measureText(a.name).width + 12, ty = sy + 14 * view.zoom
      ctx.fillStyle = a.mine ? "rgba(31,110,104,.92)" : "rgba(251,252,250,.92)"
      roundRect(ctx, sx - tw / 2, ty - 10, tw, 16, 8); ctx.fill()
      ctx.fillStyle = a.mine ? "#fff" : "#1b2b2a"; ctx.fillText(a.name, sx, ty + 2)
      ctx.restore()
    }
    // speech bubble: lives exactly as long as its 60-second entity
    const said = scene.says.get(a.home)
    if (said) drawSpeech(ctx, sx, sy - chh - hop - 8, said.data.text || "", view.zoom)
  }
}

function drawSpeech(ctx, x, y, text, zoom) {
  ctx.save()
  const fs = Math.round(12.5 * Math.min(1.25, Math.max(0.85, zoom)))
  ctx.font = `500 ${fs}px "Albert Sans", sans-serif`
  const words = text.split(" "), lines = []
  let line = ""
  for (const wd of words) { const tryLine = line ? line + " " + wd : wd; if (ctx.measureText(tryLine).width > 170 && line) { lines.push(line); line = wd } else line = tryLine }
  if (line) lines.push(line)
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18, bh = lines.length * (fs + 3) + 12
  const bx = x - bw / 2, by = y - bh - 8
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(27,43,42,.18)"; ctx.lineWidth = 1
  roundRect(ctx, bx, by, bw, bh, 10); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x - 6, by + bh - 0.5); ctx.lineTo(x, by + bh + 8); ctx.lineTo(x + 6, by + bh - 0.5); ctx.fill()
  ctx.fillStyle = "#1b2b2a"; ctx.textAlign = "center"; ctx.textBaseline = "top"
  lines.forEach((l, i) => ctx.fillText(l, x, by + 6 + i * (fs + 3)))
  ctx.restore()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

// ---------------- the island's own life: ground, decor, boats, day and night ----------------

const ALL_CELLS = []
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) ALL_CELLS.push([x, y])
ALL_CELLS.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[0] - b[0])

const hash = (x, y) => { let n = x * 374761393 + y * 668265263; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
/** Sand within a few cells of the sea, a little ragged; grass inland. Same for every client. */
export const isSand = (x, y) => Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y) < 2 + Math.floor(hash(x, y) * 2.2)

function drawDecor(ctx, x, y, sx, sy, w, h, t) {
  const r = hash(x + 101, y + 7)
  const sand = isSand(x, y)
  if (r > (sand ? 0.06 : 0.1)) return
  const pick = hash(x + 3, y + 911)
  const name = sand ? (pick < 0.45 ? "deco-grass" : pick < 0.8 ? "deco-palm" : "deco-rocks")
    : (pick < 0.32 ? "deco-pines" : pick < 0.52 ? "deco-flowers" : pick < 0.7 ? "deco-rocks" : pick < 0.84 ? "deco-palm" : pick < 0.93 ? "deco-grass" : "deco-bench")
  const sprite = img[name]
  if (!sprite?.complete || !sprite.naturalWidth) return
  const scale = { "deco-pines": 0.62, "deco-palm": 0.62, "deco-rocks": 0.42, "deco-flowers": 0.38, "deco-grass": 0.34, "deco-bench": 0.42 }[name]
  const sw = w * scale, sh = sw * (sprite.naturalHeight / sprite.naturalWidth)
  const sway = name === "deco-palm" || name === "deco-grass" ? Math.sin(t * 1.2 + x) * 0.03 : 0
  ctx.save(); ctx.translate(sx + (hash(x, y + 5) - 0.5) * w * 0.25, sy + h * 0.62); ctx.rotate(sway)
  ctx.drawImage(sprite, -sw / 2, -sh, sw, sh); ctx.restore()
}

const BOATS = [{ k: "boat-sail", side: 0, at: 0.2, speed: 0.012 }, { k: "boat-row", side: 1, at: 0.55, speed: -0.008 }, { k: "boat-sail", side: 1, at: 0.15, speed: 0.01 }, { k: "boat-row", side: 0, at: 0.8, speed: -0.006 }]
function drawBoats(view, w, h, t) {
  const { ctx } = view
  for (const b of BOATS) {
    const sprite = img[b.k]; if (!sprite?.complete || !sprite.naturalWidth) continue
    const along = (((b.at + t * b.speed) % 1) + 1) % 1 * 36 - 2
    const off = 34.5 + Math.sin(t * 0.7 + b.at * 9) * 0.6
    const { sx, sy } = b.side === 0 ? view.toScreen(off, along) : view.toScreen(along, off)
    const sw = w * (b.k === "boat-sail" ? 0.7 : 0.55), sh = sw * (sprite.naturalHeight / sprite.naturalWidth)
    const bob = Math.sin(t * 2 + b.at * 7) * 2.5 * view.zoom
    ctx.save(); ctx.translate(sx, sy + bob); if (b.speed < 0) ctx.scale(-1, 1)
    ctx.drawImage(sprite, -sw / 2, -sh * 0.85, sw, sh); ctx.restore()
  }
}

/** Day and night from the viewer's own clock (or ?t=night|dusk|day for a fixed look). */
export function skyPhase() {
  const forced = new URLSearchParams(location.search).get("t")
  if (forced) return { night: 1, dusk: 0.6, day: 0 }[forced] ?? 0
  const hr = new Date().getHours() + new Date().getMinutes() / 60
  if (hr >= 21 || hr < 5) return 1
  if (hr >= 19) return 0.5 + (hr - 19) / 4
  if (hr < 7) return 1 - (hr - 5) / 2
  return 0
}
function drawSky(view, world, head, w, h, t) {
  const { ctx } = view
  const n = skyPhase(); if (n <= 0.02) return
  ctx.save()
  ctx.globalCompositeOperation = "multiply"
  ctx.fillStyle = n < 0.7 ? `rgba(240,170,120,${0.25 * n})` : `rgba(40,58,110,${0.55 * n})`
  ctx.fillRect(0, 0, innerWidth, innerHeight)
  ctx.globalCompositeOperation = "lighter"
  // lit windows: every house that is still afloat glows a little
  for (const c of world.cells.values()) {
    const s = c.structure; if (!s || s.kind !== "home" || s.expiresAt <= head) continue
    const { sx, sy } = view.toScreen(c.x, c.y)
    const g = ctx.createRadialGradient(sx, sy + h * 0.1, 2, sx, sy + h * 0.1, w * 0.45)
    const flick = 0.85 + 0.15 * Math.sin(t * 6 + c.x)
    g.addColorStop(0, `rgba(255,200,120,${0.45 * n * flick})`); g.addColorStop(1, "rgba(255,200,120,0)")
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy + h * 0.1, w * 0.45, 0, Math.PI * 2); ctx.fill()
  }
  // stars over the sea
  if (n > 0.6) for (let i = 0; i < 60; i++) {
    const x = hash(i, 1) * innerWidth, y = hash(i, 2) * innerHeight * 0.5
    ctx.fillStyle = `rgba(255,255,240,${(0.3 + 0.4 * Math.sin(t * 2 + i)) * n})`; ctx.fillRect(x, y, 1.6, 1.6)
  }
  ctx.restore()
}
