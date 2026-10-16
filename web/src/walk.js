// Play mode: you walk your islander around the island. What you can do depends on where you stand:
// fish at the water, sleep at home, knock on a neighbour's door. Your position is a 10-minute presence
// entity (patched + extended in one batch when you arrive somewhere), and what you say is a 60-second
// entity that evaporates. Other islanders' presence and speech arrive over the live socket.
import { COMMONS, SIZE, PRESENCE_SECONDS, SAY_SECONDS, createPresence, movePresence, say, fish, needsOf, lifetimeBlocks, blocksToText, NEEDS } from "../../shared/tideland.js"
import { spriteUrl } from "./render.js"
import { poseSprite } from "./house.js"
import { sfx } from "./sfx.js"

const SPEED = 3.6 // cells per second: a stroll, not a sprint
const SYNC_AFTER_MS = 1100

export function createWalk(deps) {
  const { state, view, headNow, ensureWallet, house, toast, esc, same, short, explorer } = deps
  const $ = (id) => document.getElementById(id)
  const me = { active: false, home: null, pos: { x: 16, y: 16 }, goal: null, keys: {}, facing: 1, moving: false, arrivedAt: 0,
    presenceKey: null, synced: null, syncing: false, openOnArrival: null, fishing: null, says: [] }
  const smooth = new Map() // presence key -> displayed position, eased toward the latest synced one

  // ---------- lifecycle ----------

  function start(homeKey) {
    const h = state.things.get(homeKey)
    if (!h) return false
    me.home = h
    if (!me.active) {
      me.pos = { x: Math.min(31, h.x + 1.1), y: Math.min(31, h.y + 1.1) }
      const p = myPresence()
      if (p) { me.presenceKey = p.key; me.pos = { x: p.x + 0.5, y: p.y + 0.5 }; me.synced = { x: p.x, y: p.y } }
    }
    me.active = true
    document.body.classList.add("play")
    renderHud()
    return true
  }
  function stop() { me.active = false; document.body.classList.remove("play") }

  const myPresence = () => [...state.things.values()].filter((t) => t.kind === "presence" && t.home === me.home?.key && same(t.owner, state.wallet?.address) && t.expiresAt > headNow())
    .sort((a, b) => (a.expiresAt < b.expiresAt ? 1 : -1))[0]

  // ---------- per frame ----------

  function update(dt) {
    if (!me.active) return
    const k = me.keys
    const vx = (k.d || k.ArrowRight ? 1 : 0) - (k.a || k.ArrowLeft ? 1 : 0), vy = (k.s || k.ArrowDown ? 1 : 0) - (k.w || k.ArrowUp ? 1 : 0)
    const before = { ...me.pos }
    if (vx || vy) {
      const gx = vx + vy, gy = vy - vx, n = Math.hypot(gx, gy) || 1
      me.pos.x += (gx / n) * SPEED * dt; me.pos.y += (gy / n) * SPEED * dt; me.goal = null
      if (vx) me.facing = Math.sign(vx)
    } else if (me.goal) {
      const dx = me.goal.x - me.pos.x, dy = me.goal.y - me.pos.y, d = Math.hypot(dx, dy)
      if (d < 0.05) { me.goal = null; arrive() }
      else { const st = Math.min(d, SPEED * dt); me.pos.x += (dx / d) * st; me.pos.y += (dy / d) * st; me.facing = dx - dy >= 0 ? 1 : -1 }
    }
    me.pos.x = Math.max(0.2, Math.min(31.8, me.pos.x)); me.pos.y = Math.max(0.2, Math.min(31.8, me.pos.y))
    const was = me.moving
    me.moving = Math.hypot(me.pos.x - before.x, me.pos.y - before.y) > 1e-4
    if (was && !me.moving && !me.goal) arrive()
    // others glide toward where they last said they were
    for (const p of presences()) {
      const s = smooth.get(p.key) ?? { x: p.x + 0.5, y: p.y + 0.5 }
      const tx = p.x + 0.5, ty = p.y + 0.5, d = Math.hypot(tx - s.x, ty - s.y)
      if (d > 0.02) { const st = Math.min(d, SPEED * dt); s.x += ((tx - s.x) / d) * st; s.y += ((ty - s.y) / d) * st; s.facing = tx - s.x - (ty - s.y) >= 0 ? 1 : -1; s.moving = true } else s.moving = false
      smooth.set(p.key, s)
    }
    renderAction()
  }

  function arrive() {
    me.arrivedAt = performance.now()
    if (me.openOnArrival) { const k = me.openOnArrival; me.openOnArrival = null; house.open(k, { panel: true }) }
    setTimeout(sync, SYNC_AFTER_MS)
  }

  // ---------- presence on Arkiv ----------

  async function sync() {
    if (!me.active || me.moving || me.syncing) return
    const x = Math.round(me.pos.x - 0.5), y = Math.round(me.pos.y - 0.5)
    if (me.synced && me.synced.x === x && me.synced.y === y && me.presenceKey && (state.things.get(me.presenceKey)?.expiresAt ?? 0n) - headNow() > 120n) return
    me.syncing = true
    try {
      const w = await ensureWallet({ quiet: true }); if (!w) return
      if (!me.presenceKey || !(state.things.get(me.presenceKey)?.expiresAt > headNow())) {
        const r = await createPresence(w.client, { home: me.home, x, y })
        me.presenceKey = r.entityKey
        // record it now, so the next sync patches this one instead of creating another before the world re-reads
        state.things.set(r.entityKey, { key: r.entityKey, kind: "presence", home: me.home.key, x, y, look: me.home.look, data: { name: me.home.data?.islander },
          owner: w.address, creator: w.address, createdAt: headNow(), expiresAt: headNow() + lifetimeBlocks(PRESENCE_SECONDS) })
      } else {
        await movePresence(w.client, { key: me.presenceKey, x, y })
      }
      me.synced = { x, y }
      const p = state.things.get(me.presenceKey)
      if (p) { p.x = x; p.y = y; p.expiresAt = headNow() + lifetimeBlocks(PRESENCE_SECONDS) }
    } catch (e) { console.warn("presence", e.shortMessage || e.message) }
    finally { me.syncing = false; if (!me.moving) { const nx = Math.round(me.pos.x - 0.5), ny = Math.round(me.pos.y - 0.5); if (!me.synced || nx !== me.synced.x || ny !== me.synced.y) setTimeout(sync, 300) } }
  }
  // keep presence alive while the tab is open and you're around
  setInterval(() => { if (me.active && document.visibilityState === "visible") sync() }, 60_000)

  // ---------- what's here ----------

  const head = () => headNow()
  function presences() {
    const h = head()
    return [...state.things.values()].filter((t) => t.kind === "presence" && t.expiresAt > h && t.key !== me.presenceKey && !same(t.owner, state.wallet?.address) && t.x !== undefined)
  }
  function nearby() {
    const cx = me.pos.x - 0.5, cy = me.pos.y - 0.5
    let best = null, bd = 1.7
    for (const c of state.cells.values()) {
      const s = c.structure; if (!s) continue
      const d = Math.hypot(c.x - cx, c.y - cy)
      if (d < bd && (s.kind === "home" || COMMONS.includes(s.material))) { bd = d; best = s }
    }
    return best
  }
  const atWater = () => me.pos.x > 28.6 || me.pos.y > 28.6 || COMMONS.includes(nearby()?.material)

  function myNeeds() {
    const life = [...state.things.values()].filter((t) => t.home === me.home.key)
    return needsOf(me.home, life, head())
  }

  // ---------- HUD, action button, chat ----------

  function renderHud() {
    if (!me.active || !me.home) return
    const n = myNeeds(), h = me.home
    $("me-hud").innerHTML = `<button class="me-face" data-walk="mine"><img src="${spriteUrl(poseSprite(h.look, n.mood))}" alt="" /></button>
      <div class="me-info"><b>${esc(h.data.islander || "You")}</b>
        <div class="minibars">${[["🍲", n.food], ["😴", n.rest], ["🤝", n.friends], ["🏠", n.home]].map(([e, f]) => `<span title="${e}"><i>${e}</i><em><u style="width:${(f * 100).toFixed(0)}%" class="${f < 0.15 ? "low" : ""}"></u></em></span>`).join("")}</div></div>`
  }
  setInterval(renderHud, 5000)

  let lastAction = ""
  function renderAction() {
    const el = $("me-action"); if (!el) return
    let html = ""
    const s = nearby(), n = me.home ? myNeeds() : null
    if (me.fishing) html = `<button class="holdbtn act" id="w-fish" data-walk="fish"><span class="ring"></span><span class="lbl">${me.fishing.got ? "🐟 Got one! Let go" : "🎣 Waiting for a bite…"}</span></button>`
    else if (s?.kind === "home" && s.key === me.home?.key) html = `<button class="primary act" data-walk="mine">🏠 ${esc(me.home.data.islander || "Your")}'s house</button>${n && n.rest < 0.5 ? `<button class="primary act" data-walk="sleep">😴 Sleep</button>` : ""}`
    else if (s?.kind === "home") html = `<button class="primary act" data-walk="visit" data-key="${s.key}">🚪 Visit ${esc(s.data.islander || s.data.name)}</button>`
    else if (atWater() && n) html = n.food < 0.6 ? `<button class="holdbtn act" id="w-fish" data-walk="fish"><span class="ring"></span><span class="lbl">🎣 Hold to fish</span></button>` : `<span class="hint-pill">🎣 Not hungry right now</span>`
    else if (!me.moving) html = `<span class="hint-pill">Tap anywhere to walk · find water to fish · knock on doors</span>`
    if (html !== lastAction) { el.innerHTML = html; lastAction = html }
  }

  async function doSleep() {
    try {
      const w = await ensureWallet({ quiet: false })
      const { sleep } = await import("../../shared/tideland.js")
      toast("😴 Going to bed…", 0)
      const r = await sleep(w.client, { home: me.home })
      state.things.set(r.entityKey, { key: r.entityKey, kind: "sleep", home: me.home.key, creator: w.address, owner: w.address, createdAt: head(), expiresAt: head() + lifetimeBlocks(NEEDS.rest.seconds), data: {} })
      sfx.bell(); toast(`Goodnight. Rested for 12 hours. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">receipt</a>`, 5000); renderHud()
    } catch (e) { toast(`Couldn't sleep: ${esc(String(e.shortMessage || e.message).slice(0, 100))}`, 5000) }
  }

  function fishDown() {
    if (me.fishing) return
    me.fishing = { t0: performance.now(), got: false }
    me.fishing.timer = setInterval(() => { if (me.fishing && performance.now() - me.fishing.t0 > 2200) { me.fishing.got = true; clearInterval(me.fishing.timer); sfx.full() } }, 100)
  }
  async function fishUp() {
    const f = me.fishing; if (!f) return
    clearInterval(f.timer); me.fishing = null
    if (!f.got) { toast("It got away. Hold until it bites.", 2500); return }
    const dish = ["grilled mackerel", "smoked herring", "fish stew"][Math.floor(Math.random() * 3)]
    try {
      const w = await ensureWallet({ quiet: false })
      toast(`🐟 Cooking ${dish}…`, 0)
      const r = await fish(w.client, { home: me.home, dish })
      state.things.set(r.entityKey, { key: r.entityKey, kind: "meal", home: me.home.key, creator: w.address, owner: w.address, createdAt: head(), expiresAt: head() + lifetimeBlocks(NEEDS.food.seconds), data: { dish } })
      sfx.bell(); toast(`Caught ${dish}. Full for 8 hours. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">receipt</a>`, 5000); renderHud()
    } catch (e) { toast(`Couldn't cook: ${esc(String(e.shortMessage || e.message).slice(0, 100))}`, 5000) }
  }

  async function speak(text) {
    text = text.trim(); if (!text || !me.home) return
    const x = Math.round(me.pos.x - 0.5), y = Math.round(me.pos.y - 0.5)
    const local = { key: `local-${Date.now()}`, kind: "say", home: me.home.key, x, y, data: { text }, creator: state.wallet?.address, createdAt: head(), expiresAt: head() + lifetimeBlocks(SAY_SECONDS), local: true }
    state.things.set(local.key, local)
    try {
      const w = await ensureWallet({ quiet: true })
      const r = await say(w.client, { home: me.home, x, y, text })
      state.things.delete(local.key)
      state.things.set(r.entityKey, { ...local, key: r.entityKey, local: false })
    } catch (e) { toast(`Your words didn't carry: ${esc(String(e.shortMessage || e.message).slice(0, 90))}`, 4000) }
  }

  // ---------- input ----------

  function pointerDown(px, py) {
    if (!me.active) return false
    const g = view.toGrid(px, py); if (!g) return true
    const s = state.cells.get(`${g.x}:${g.y}`)?.structure
    if (s?.kind === "home") { me.goal = { x: Math.min(31.5, s.x + 1.2), y: Math.min(31.5, s.y + 1.2) }; me.openOnArrival = s.key === me.home?.key ? null : s.key }
    else { me.goal = { x: g.x + 0.5, y: g.y + 0.5 }; me.openOnArrival = null }
    return true
  }
  function key(e, down) {
    if (!me.active || document.activeElement?.tagName === "INPUT") return false
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) { e.preventDefault(); me.keys[k] = down; return true }
    return false
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-walk]")?.dataset.walk
    if (a === "mine") house.open(me.home.key, { panel: true })
    else if (a === "visit") house.open(e.target.closest("[data-walk]").dataset.key, { panel: true })
    else if (a === "sleep") doSleep()
  })
  document.addEventListener("pointerdown", (e) => { if (e.target.closest("#w-fish")) { e.preventDefault(); fishDown() } })
  document.addEventListener("pointerup", () => { if (me.fishing) fishUp() })
  $("chat-form")?.addEventListener("submit", (e) => { e.preventDefault(); const i = $("chat-input"); speak(i.value); i.value = ""; i.blur() })

  // ---------- what the renderer needs ----------

  function scene() {
    if (!me.active) return null
    const h = head()
    const says = new Map()
    for (const t of state.things.values()) if (t.kind === "say" && t.expiresAt > h) { const prev = says.get(t.home); if (!prev || prev.createdAt < t.createdAt) says.set(t.home, t) }
    const others = presences().map((p) => ({ key: p.key, home: p.home, look: p.look, name: p.data?.name, pos: smooth.get(p.key) ?? { x: p.x + 0.5, y: p.y + 0.5 }, mood: state.moods?.get(p.home) }))
    return { me: { ...me, mood: me.home ? myNeeds().mood : "happy", name: me.home?.data?.islander }, others, says }
  }

  return { start, stop, update, pointerDown, key, scene, renderHud, get active() { return me.active }, get me() { return me } }
}
