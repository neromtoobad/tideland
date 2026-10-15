// Isometric canvas renderer. Pure drawing: it reads the world model and never touches Arkiv.
import { SIZE, lifeLeft, BLOCK_SECONDS } from "../../shared/tideland.js"

const TW = 96, TH = 48 // tile diamond at zoom 1
const SPRITES = ["driftwood", "pine", "stone", "monument", "lighthouse", "plot", "inscription",
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
  const w = TW * zoom, h = TH * zoom
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

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
    ctx.fillStyle = ["#ece3cb", "#e9dfc4", "#eee6d0", "#e6dcbf", "#ebe2c8"][shade]
    diamond(ctx, sx, sy, w, h); ctx.fill()
  }

  // depth-sorted objects
  const order = [...world.cells.values()].sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x)
  const actors = []
  for (const c of order) {
    const { sx, sy } = view.toScreen(c.x, c.y)
    if (sx < -w * 2 || sx > innerWidth + w * 2 || sy < -h * 6 || sy > innerHeight + h * 2) continue
    const s = c.structure
    if (s) {
      drawThing(ctx, s.material, s, head, sx, sy, w, h, t)
      if (s.material === "lighthouse" && s.expiresAt > head) drawBeam(ctx, s, head, sx, sy, w, t)
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
  const shown = zoom < 0.45 ? [] : actors.filter((a) => a.s.expiresAt - head < DAY || parseInt(a.s.key.slice(-2), 16) % 3 === 0)
  for (const a of shown) {
    const sad = a.s.expiresAt - head < DAY
    const sprite = img[`${a.ch}${sad ? "-sad" : ""}`]
    if (!sprite?.complete) continue
    const { sx, sy } = view.toScreen(a.c.x, a.c.y)
    const cw = w * 0.34, chh = cw * (sprite.naturalHeight / sprite.naturalWidth)
    const bob = sad ? 0 : Math.sin(t * 3 + a.c.x) * 1.5 * zoom
    ctx.drawImage(sprite, sx + w * 0.14, sy + h * 0.95 - chh + bob, cw, chh)
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
  // the last six hours: it settles into the sand and the water rises around it
  const sinking = left < 10800 ? 1 - Math.max(0, left) / 10800 : 0
  by += sinking * sh * 0.28
  ctx.save()
  if (frac < 0.35 || left < 43200) ctx.filter = `saturate(${0.45 + frac}) sepia(${left < 43200 ? 0.35 : 0.15})`
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
