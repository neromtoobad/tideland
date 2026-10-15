// Keeper Run: a 90-second storm shift. You run between the coast's commons and patch them before
// they sink. Patches are instant on screen and sealed on-chain in atomic batches of Lifetime
// Extensions, signed by your own key. It only works because commons are created with
// permissionlessExtension: nobody owns their upkeep, so anybody can do it.
import { MATERIALS, COMMONS, patchBlocks, maxExpiry, sealPatches, recordRun, runsQuery, collect, lifeLeft, blocksToText, BLOCK_SECONDS } from "../../shared/tideland.js"
import { sfx, setMuted, muted } from "./sfx.js"
import { spriteUrl } from "./render.js"

export const RUN_SECONDS = 90
const TICK_MS = 190 // one patch tick while holding
const FLUSH_MS = 2500 // seal at most this often (one batch in flight at a time)
const SPEED = 9 // cells per second
export const KEEPERS = {
  carpenter: { label: "Carpenter", line: "Quick hands. Pine and planks." },
  mason: { label: "Mason", line: "Heavy blows. Walls stay up." },
  lamplighter: { label: "Lamplighter", line: "Knows every bell on the coast." },
}
const keeperName = (address) => {
  const a = ["Salt", "Brine", "Gull", "Kelp", "Shoal", "Tern", "Wrack", "Spray"], b = ["warden", "keeper", "mender", "watch", "hand", "lamp"]
  const n = parseInt(address.slice(2, 8), 16)
  return `${a[n % a.length]}${b[(n >> 4) % b.length]} ${address.slice(2, 6)}`
}

export function createRun(deps) {
  const { state, view, headNow, ensureWallet, pub, toast, refresh, explorer } = deps
  const $ = (id) => document.getElementById(id)
  let run = null

  // ---------- lifecycle ----------

  function openLobby() {
    document.body.classList.add("lobby")
    $("run-lobby").hidden = false
    renderLobby()
    loadBoard()
  }

  function renderLobby(picked = state.keeper || "carpenter") {
    state.keeper = picked
    $("run-keepers").innerHTML = Object.entries(KEEPERS).map(([k, v]) => `
      <button class="keeper" data-keeper="${k}" aria-pressed="${k === picked}">
        <img src="${spriteUrl(k)}" alt="" /><b>${v.label}</b><span>${v.line}</span></button>`).join("")
    const danger = commons().filter((c) => c.expiresAt - headNow() < 1800n).length
    $("run-danger").textContent = danger ? `${danger} commons sink within the hour.` : "The commons are holding. For now."
  }

  async function loadBoard() {
    try {
      const runs = (await collect(runsQuery(pub()))).filter((r) => r.expiresAt > headNow())
      const rows = runs.map((r) => ({ ...r, score: Number(r.attrs?.score ?? 0) })).sort((a, b) => b.score - a.score)
      $("run-board").innerHTML = rows.length ? rows.slice(0, 8).map((r, i) => `
        <li><span class="rk">${i + 1}</span><span class="nm">${keeperName(r.creator)}</span><span class="sc">${r.score.toLocaleString()}</span>
        <span class="fd">fades in ${blocksToText(r.expiresAt - headNow())}</span></li>`).join("")
        : `<li class="empty">No runs yet. The first keeper gets remembered longest.</li>`
    } catch { $("run-board").innerHTML = `<li class="empty">Board unavailable right now.</li>` }
  }

  async function start() {
    const wallet = await ensureWallet()
    if (!wallet) return
    $("run-lobby").hidden = true
    document.body.classList.remove("lobby"); document.body.classList.add("running")
    const home = commons().sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1))[0]
    run = {
      t0: performance.now(), ended: false, keeper: state.keeper || "carpenter",
      pos: home ? { x: home.x - 1, y: home.y - 1 } : { x: 16, y: 16 }, goal: null, target: null, holding: false, keys: {},
      queue: new Map(), inflight: null, lastFlush: 0, lastTick: 0,
      score: 0, savedBlocks: 0n, pendingBlocks: 0n, patches: 0, batches: 0, txs: [], lost: 0, clutches: 0,
      combo: 0, comboAt: 0, maxCombo: 0, floaters: [], particles: [], shake: 0, nextWave: 3, waves: [],
      optimistic: new Map(), seen: new Set(commons().map((c) => c.key)), facing: 1, sadUntil: 0,
    }
    view.run = run
    sfx.start(); sfx.storm(true)
    run.banner = performance.now()
    hud()
  }

  async function finish() {
    if (!run || run.ended) return
    run.ended = true
    run.holding = false
    sfx.storm(false); sfx.end()
    $("run-hud").querySelector(".timer").textContent = "0:00"
    // seal whatever is left, then record the run itself
    await flush(true)
    while (run.inflight) await run.inflight.catch(() => {})
    if (run.queue.size) await flush(true)
    while (run.inflight) await run.inflight.catch(() => {})
    let record = null
    if (run.patches > 0) {
      try {
        record = await recordRun(state.wallet.client, {
          score: run.score, saved: Number(run.savedBlocks) * BLOCK_SECONDS / 60, patches: run.patches,
          batches: run.batches, maxCombo: run.maxCombo, keeper: run.keeper, txs: run.txs,
        })
      } catch (e) { console.warn("record", e) }
    }
    showResults(record)
  }

  function showResults(record) {
    document.body.classList.remove("running")
    const hours = Number(run.savedBlocks) * BLOCK_SECONDS / 3600
    $("run-result").hidden = false
    $("run-result-body").innerHTML = `
      <div class="eyebrow">Shift over</div>
      <h2>${Math.round(run.score).toLocaleString()} <small>points</small></h2>
      <div class="statgrid">
        <div><b>${hours.toFixed(1)} h</b><span>of life sealed on-chain</span></div>
        <div><b>${run.patches}</b><span>patches</span></div>
        <div><b>${run.batches}</b><span>atomic batches</span></div>
        <div><b>×${run.maxCombo}</b><span>best combo</span></div>
        <div><b>${run.clutches}</b><span>clutch saves</span></div>
        <div><b>${run.lost}</b><span>lost to the tide</span></div>
      </div>
      ${record ? `<p class="note">Your run is now an Arkiv entity, read-only, and it will be remembered for <b>${blocksToText(record.expiresAt - headNow())}</b>. Better runs last longer. <a href="${explorer}/tx/${record.txHash}" target="_blank" rel="noopener">see it on-chain</a></p>`
        : run.patches ? `<p class="note">The run could not be recorded this time; your patches are still on-chain.</p>` : `<p class="note">No patches this shift, so nothing to record.</p>`}
      <p class="note mono small">${run.txs.slice(-6).map((h) => `<a href="${explorer}/tx/${h}" target="_blank" rel="noopener">${h.slice(0, 10)}…</a>`).join(" · ")}</p>
      <div class="row"><button class="primary" data-run="again">Another shift</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(`I kept the Tideland coast afloat for ${hours.toFixed(1)} hours tonight: ${Math.round(run.score)} points, ${run.patches} patches sealed on @arkiv_network. Everything nobody tends sinks.`)}&url=${encodeURIComponent(location.origin)}">Share on X</a>
      <button class="ghost" data-run="close">Back to the coast</button></div>`
    view.run = null
    refresh().catch(() => {})
  }

  // ---------- the world as the run sees it ----------

  const commons = () => [...state.cells.values()].map((c) => c.structure).filter((s) => s && COMMONS.includes(s.material) && s.expiresAt > headNow())
  const expiryOf = (s) => {
    const o = run?.optimistic.get(s.key)
    return o && o > s.expiresAt ? o : s.expiresAt
  }

  /** Called by the live socket: someone extended an entity. Keeps our targets ahead of theirs. */
  function onExtended(key, expiresAt) {
    const t = state.things.get(key); if (t && expiresAt > t.expiresAt) t.expiresAt = expiresAt
  }

  // ---------- patching ----------

  function patchTick(s, now) {
    const head = headNow()
    const current = expiryOf(s)
    const cap = maxExpiry(s.material, head)
    const next = current + patchBlocks(s.material) > cap ? cap : current + patchBlocks(s.material)
    if (next <= current) {
      if (now - (run.lastFull ?? 0) > 900) { run.lastFull = now; floater(s, -40, "full", "#5e7472"); sfx.full() }
      return
    }
    const added = next - current
    const fracBefore = Math.max(0, Number(current - head)) / Number(maxExpiry(s.material, 0n))
    const urgency = 1 + 2 * (1 - Math.min(1, fracBefore))
    const clutch = fracBefore < 0.08
    run.combo = now - run.comboAt < 1400 ? run.combo + 1 : 1
    run.comboAt = now
    run.maxCombo = Math.max(run.maxCombo, run.combo)
    const minutes = (Number(added) * BLOCK_SECONDS) / 60
    const pts = 10 * minutes * urgency * (1 + Math.min(run.combo, 40) / 10) * (clutch ? 2 : 1)
    run.score += pts
    run.pendingBlocks += added
    run.patches++
    run.optimistic.set(s.key, next)
    const q = run.queue.get(s.key)
    run.queue.set(s.key, { key: s.key, target: next, added: (q?.added ?? 0n) + added })
    floater(s, -50, `+${minutes < 60 ? Math.round(minutes) + "m" : (minutes / 60).toFixed(1) + "h"}`, clutch ? "#b4552e" : "#1f6e68")
    burst(s, clutch ? "#e7b65a" : "#c9a66b", clutch ? 14 : 7)
    run.shake = Math.min(6, run.shake + (clutch ? 4 : 1.2))
    if (clutch) { run.clutches++; floater(s, -85, "CLUTCH", "#b4552e", 1.4); sfx.clutch() } else sfx.hammer(run.combo)
  }

  async function flush(force = false) {
    if (!run || run.inflight || !run.queue.size) return
    const now = performance.now()
    if (!force && now - run.lastFlush < FLUSH_MS) return
    run.lastFlush = now
    const batch = [...run.queue.values()]
    run.queue.clear()
    const added = batch.reduce((a, p) => a + p.added, 0n)
    hud()
    run.inflight = sealPatches(state.wallet.client, batch).then((r) => {
      run.batches++; run.txs.push(r.txHash)
      run.savedBlocks += added; run.pendingBlocks -= added
      for (const p of batch) onExtended(p.key, p.target)
      sfx.bell()
    }).catch((e) => {
      run.pendingBlocks -= added
      // Most likely someone else extended one of these further: drop our optimistic view and carry on.
      for (const p of batch) run.optimistic.delete(p.key)
      console.warn("seal failed", e)
      toast(`A batch didn't seal (${String(e.shortMessage || e.message).slice(0, 90)}). Keep going, the next one will.`, 4000)
    }).finally(() => { run.inflight = null; hud() })
  }

  // ---------- per-frame update (called from main's frame loop) ----------

  function update(dt) {
    if (!run || run.ended) return
    const now = performance.now(), left = RUN_SECONDS - (now - run.t0) / 1000
    if (left <= 0) { finish(); return }

    // movement: keys, or run toward the clicked goal
    const k = run.keys
    let vx = (k.d || k.ArrowRight ? 1 : 0) - (k.a || k.ArrowLeft ? 1 : 0), vy = (k.s || k.ArrowDown ? 1 : 0) - (k.w || k.ArrowUp ? 1 : 0)
    if (vx || vy) { // screen-space intent -> grid axes
      const gx = vx + vy, gy = vy - vx, n = Math.hypot(gx, gy) || 1
      run.pos.x += (gx / n) * SPEED * dt; run.pos.y += (gy / n) * SPEED * dt; run.goal = null
      run.facing = vx ? Math.sign(vx) : run.facing
    } else if (run.goal) {
      const dx = run.goal.x - run.pos.x, dy = run.goal.y - run.pos.y, d = Math.hypot(dx, dy)
      if (d < 0.05) run.goal = null
      else { const step = Math.min(d, SPEED * dt); run.pos.x += (dx / d) * step; run.pos.y += (dy / d) * step; run.facing = (dx - dy) >= 0 ? 1 : -1 }
    }
    run.pos.x = Math.max(0, Math.min(31.5, run.pos.x)); run.pos.y = Math.max(0, Math.min(31.5, run.pos.y))

    // patch the target while holding, once we're beside it
    const s = run.target && state.things.get(run.target)
    const near = s && Math.hypot(s.x + 0.5 - run.pos.x, s.y + 0.5 - run.pos.y) < 1.4
    if (s && run.holding && near && now - run.lastTick > TICK_MS) { run.lastTick = now; patchTick(s, now) }
    run.patchingNow = !!(s && run.holding && near)

    // commons that sank during the shift
    const head = headNow()
    for (const c of state.things.values()) {
      if (c.kind !== "structure" || !COMMONS.includes(c.material)) continue
      if (run.seen.has(c.key) && expiryOf(c) <= head) {
        run.seen.delete(c.key); run.lost++; run.sadUntil = now + 2500
        floater(c, -40, "lost", "#b4552e", 1.3); view.splash?.(c); sfx.sink()
      }
    }

    // storm surges
    if ((now - run.t0) / 1000 > run.nextWave) { run.waves.push({ at: now }); run.nextWave += 7 + Math.random() * 4; sfx.wave(); run.shake = Math.min(8, run.shake + 3) }
    run.waves = run.waves.filter((w) => now - w.at < 2600)

    run.shake *= 0.88
    run.floaters = run.floaters.filter((f) => now - f.at < 1100 * (f.life ?? 1))
    run.particles = run.particles.filter((p) => { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; return now - p.at < 700 })
    if (now - run.comboAt > 1400) run.combo = 0
    flush()
    hudFast(left)
  }

  // ---------- effects ----------

  // Effects are anchored to a grid cell (so they stay put while the camera follows you) plus a pixel offset.
  function floater(cell, dy, text, color, life = 1) { run.floaters.push({ gx: cell.x, gy: cell.y, dx: (Math.random() - 0.5) * 30, dy, text, color, life, at: performance.now() }) }
  function burst(cell, color, n) {
    for (let i = 0; i < n; i++) run.particles.push({ gx: cell.x, gy: cell.y, x: 0, y: -10, vx: (Math.random() - 0.5) * 260, vy: -120 - Math.random() * 260, color, at: performance.now(), r: 2 + Math.random() * 3 })
  }

  // ---------- HUD ----------

  function hudFast(left) {
    const h = $("run-hud"); if (!h) return
    h.querySelector(".timer").textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`
    h.querySelector(".timer").classList.toggle("low", left < 15)
    h.querySelector(".score").textContent = Math.round(run.score).toLocaleString()
    h.querySelector(".combo").textContent = run.combo > 1 ? `combo ×${run.combo}` : ""
  }
  function hud() {
    const h = $("run-hud"); if (!h || !run) return
    const sealed = Number(run.savedBlocks) * BLOCK_SECONDS / 3600, pending = Number(run.pendingBlocks) * BLOCK_SECONDS / 3600
    h.querySelector(".sealed").innerHTML = `<b>${sealed.toFixed(1)} h</b> sealed${run.inflight ? ` · <span class="pulse">sealing ${pending.toFixed(1)} h…</span>` : ""}`
    h.querySelector(".txs").innerHTML = run.txs.length ? `${run.batches} batch${run.batches > 1 ? "es" : ""} · <a href="${explorer}/tx/${run.txs.at(-1)}" target="_blank" rel="noopener">last tx</a>` : "patches seal in batches"
  }

  // ---------- input ----------

  function pointerDown(px, py) {
    if (!run || run.ended) return false
    const g = view.toGrid(px, py)
    const c = g && state.cells.get(`${g.x}:${g.y}`)
    const s = c?.structure
    if (s && COMMONS.includes(s.material)) {
      run.target = s.key; run.holding = true
      run.goal = { x: s.x + 1.05, y: s.y + 1.05 } // stand in front of it (screen-down is +x +y)
    } else if (g) { run.goal = { x: g.x + 0.5, y: g.y + 0.5 }; run.holding = false }
    return true
  }
  function pointerUp() { if (run) run.holding = false }
  function key(e, down) {
    if (!run || run.ended) return false
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (k === " ") {
      e.preventDefault()
      if (down && !run.holding) { // patch the nearest commons
        let best = null, bd = 9
        for (const s of commons()) { const d = Math.hypot(s.x + 0.5 - run.pos.x, s.y + 0.5 - run.pos.y); if (d < bd) { bd = d; best = s } }
        if (best) run.target = best.key
      }
      run.holding = down; return true
    }
    if (["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) { e.preventDefault(); run.keys[k] = down; return true }
    return false
  }

  // ---------- DOM wiring ----------
  document.addEventListener("click", (e) => {
    const kp = e.target.closest("[data-keeper]"); if (kp) { renderLobby(kp.dataset.keeper); return }
    const r = e.target.closest("[data-run]")?.dataset.run; if (!r) return
    if (r === "start") start()
    else if (r === "lobby") openLobby()
    else if (r === "cancel") { $("run-lobby").hidden = true; document.body.classList.remove("lobby") }
    else if (r === "again") { $("run-result").hidden = true; openLobby() }
    else if (r === "close") { $("run-result").hidden = true }
    else if (r === "mute") { setMuted(!muted); e.target.textContent = muted ? "sound off" : "sound on" }
  })

  return { openLobby, update, pointerDown, pointerUp, key, onExtended, get active() { return !!run && !run.ended }, get run() { return run } }
}
