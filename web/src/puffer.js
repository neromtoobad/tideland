// Puffer Pass: hot potato on the beach, with your house as the stake.
// The puffer is an Arkiv entity whose expiry is the fuse; its holder is its $owner. Passing is a
// changeOwnership sealed with a signed pass record; the pop is the network's expiry, so no server decides
// who loses. This module is the table screen: a circle of islanders, the swelling puffer, and the duties
// each client takes on (record a pop, serve the next puffer, move the crew's bots).
import {
  PUFFER, BLOCK_SECONDS, openTable, takeSeat, servePuffer, passPuffer, popPuffer, tableQuery, tablesQuery, resolveTable,
  collect, toThing, blocksToText, floodOf,
} from "../../shared/tideland.js"
import { spriteUrl } from "./render.js"
import { poseSprite } from "./house.js"
import { sfx } from "./sfx.js"
import { celebrate } from "./celebrate.js"

const BLOCK_MS = BLOCK_SECONDS * 1000
const fmtMin = (m) => (m < 60 ? `${m} min` : `${(m / 60).toFixed(m % 60 ? 1 : 0)} h`)

export function createPuffer(deps) {
  const { state, headNow, pub, reading, ensureWallet, toast, esc, short, same, explorer, house, onClose } = deps
  const $ = (id) => document.getElementById(id)
  const canvas = $("pp-canvas"), ctx = canvas.getContext("2d")
  const lc = (a) => String(a ?? "").toLowerCase()

  const t = {
    active: false, key: null, table: null, recs: [], live: [], g: null, loadedAt: 0,
    crew: new Set(), passTx: new Set(), log: [], duty: new Set(), flights: [], fx: [], hover: null,
    throwing: null, serving: null, seen: new Map(), poppedSeen: new Set(), anim: 0, lastTick: 0, openTables: [], busy: false,
  }
  const me = () => lc(state.wallet?.address)
  const mySeat = () => t.g?.seats.find((s) => s.player === me())
  const seatOf = (p) => t.g?.seats.find((s) => s.player === lc(p))
  const nameOf = (p) => (lc(p) === me() ? "You" : seatOf(p)?.name ?? short(p))
  const isCrew = (p) => t.crew.has(lc(p))

  // a precise, continuous head: blocks are 2 s apart, and the socket tells us when a new one landed
  let headSync = { block: 0n, at: 0 }
  const headFloat = () => {
    const base = headSync.block > state.head ? headSync : { block: state.head, at: state.headAt }
    return Number(base.block) + (Date.now() - base.at) / BLOCK_MS
  }
  const headInt = () => BigInt(Math.floor(headFloat()))
  async function syncHead() {
    try { const b = (await pub().getBlockTiming()).currentBlock; headSync = { block: b, at: Date.now() } } catch {}
  }

  // ---------- crew (the island's bots, so you never play alone) ----------

  async function crewCall(body) {
    const r = await fetch("/api/crew", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `crew ${r.status}`)
    return j
  }
  async function loadCrew() {
    if (t.crew.size) return
    try { const j = await crewCall({ op: "who" }); for (const a of j.crew ?? []) t.crew.add(lc(a)) } catch {}
  }

  // ---------- open / close ----------

  async function open(key) {
    t.active = true; document.body.classList.add("puffing"); $("pp").hidden = false
    resize()
    if (!t.raf) t.raf = requestAnimationFrame(frame)
    loadCrew()
    syncHead()
    if (!key) { t.key = null; t.g = null; history.replaceState(null, "", "?play"); renderPanel(); loadTables(); return }
    t.key = key; t.table = null; t.recs = []; t.live = []; t.g = null; t.log = []; t.duty.clear(); t.poppedSeen.clear(); t.flights = []; t.fx = []
    history.replaceState(null, "", `?t=${key}`)
    renderPanel()
    await load()
  }
  function close() {
    t.active = false; t.key = null; $("pp").hidden = true; document.body.classList.remove("puffing")
    cancelAnimationFrame(t.raf); t.raf = null
    history.replaceState(null, "", location.pathname)
    onClose?.()
  }

  async function loadTables() {
    try {
      const head = headNow()
      const tables = (await reading(() => collect(tablesQuery(pub())))).filter((x) => x.expiresAt > head).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 6)
      t.openTables = tables
      if (!t.key) renderPanel()
    } catch {}
  }

  async function load() {
    const key = t.key
    if (!key) return
    try {
      if (!t.table) t.table = toThing(await reading(() => pub().getEntity(key)))
    } catch { /* the table itself expires after 30 min; its records outlive it */ t.table ??= { key, attrs: {}, data: {} } }
    try {
      const recs = await reading(() => collect(tableQuery(pub(), key)))
      if (t.key !== key) return
      t.recs = recs; t.loadedAt = Date.now()
      // drop live passes the records now cover
      t.live = t.live.filter((l) => !recs.some((r) => r.kind === "pass" && lc(r.attrs.puffer) === lc(l.puffer) && r.createdAt === l.createdAt))
      update()
    } catch (e) { console.warn("table read", e) }
  }
  let loadT = null
  const loadSoon = (ms = 700) => { clearTimeout(loadT); loadT = setTimeout(load, ms) }

  // ---------- the rules, then everything that follows from them ----------

  let lastPhase = ""
  function update() {
    if (!t.key) return
    const prev = t.g
    t.g = resolveTable(t.table, t.recs, headInt(), t.live)
    const g = t.g
    // log what's new
    if (prev?.current?.puffer !== g.current?.puffer && g.current && g.current.server !== me()) {
      log(`${nameOf(g.current.server)} served a puffer to ${nameOf(g.current.holder)}`, null)
      sfx.start()
    }
    for (const p of g.pops) {
      const id = `${p.round}:${p.puffer}`
      if (t.poppedSeen.has(id)) continue
      t.poppedSeen.add(id)
      if (prev) burst(p.holder)
      log(`🐡 POP! ${nameOf(p.holder)} ${lc(p.holder) === me() ? "are" : "is"} out.${p.record ? " Flood recorded" : ""}`, null, false, p.record?.key)
    }
    const phaseKey = `${g.phase}:${g.round}:${!!g.win}:${g.seats.length}`
    if (phaseKey !== lastPhase) { lastPhase = phaseKey; renderPanel() } else renderStatus()
    if (g.phase === "done" && prev && prev.phase !== "done") {
      const w = g.winner
      setTimeout(() => celebrate(w.player === me() ? "You win the pot!" : `${esc(w.name)} wins the pot`, `${fmtMin(g.pot)} of house life, from everyone's stake.`), 900)
    }
    duties()
  }

  // ---------- duties: whoever can, does them; duplicates are harmless (they revert or are ignored) ----------

  const drivers = () => (t.g?.seats ?? []).filter((s) => !isCrew(s.player))
  const iDrive = () => { const humans = drivers(); return humans.length && humans[0].player === me() }
  const once = (id, ms, fn) => { if (t.duty.has(id)) return; t.duty.add(id); setTimeout(() => { if (t.active && t.key) fn().catch((e) => { console.warn(id, e); t.duty.delete(id) }) }, ms) }

  function duties() {
    const g = t.g
    if (!g || !state.wallet) return
    const seated = !!mySeat()
    // 1. a pop nobody has written yet: the loser first, then the crew's driver, then any witness
    const last = g.last
    if (last && !last.record) {
      const winnerHome = g.winner && !g.win ? g.winner.home : null
      const args = { table: t.key, round: last.round, puffer: last.puffer, loser: last.holder, loserHome: seatOf(last.holder)?.home, potMinutes: g.pot }
      if (last.holder === me()) once(`pop:${last.round}`, 300, () => writePop(args, winnerHome))
      else if (isCrew(last.holder) && iDrive()) once(`pop:${last.round}`, 900, () => crewCall({ op: "pop", bot: last.holder, ...args, winnerHome }))
      else if (seated) once(`pop:${last.round}`, 7000, async () => { if (!t.g.last?.record) await writePop(args, winnerHome) })
    }
    // 2. serve the next puffer: the one who popped serves (revenge), else a bot driver, else anyone after a wait
    if (g.phase === "between" && last) {
      const round = g.round
      if (last.holder === me()) startServePick(round)
      else if (isCrew(last.holder) && iDrive()) once(`serve:${round}`, 2600, () => crewCall({ op: "serve", bot: last.holder, table: t.key, round, to: pickTarget(g.alive.map((s) => s.player), null, true), fuseSeconds: fuse() }))
      else if (seated) once(`serve:${round}`, 12000, async () => { if (t.g.phase === "between" && t.g.round === round) await serve(round, pickTarget(t.g.alive.map((s) => s.player).filter((p) => p !== me()), null, true)) })
    }
    // 3. a bot holds the puffer: it thinks for a moment, then passes (the driver asks the crew to sign)
    const c = g.current
    const holdId = c && `bot:${c.puffer}:${c.hops}`
    if (c && !t.seen.has(holdId)) t.seen.set(holdId, Date.now())
    if (c && isCrew(c.holder) && (iDrive() || Date.now() - t.seen.get(holdId) > 9000)) {
      const id = holdId
      if (!t.duty.has(id)) {
        const left = (Number(c.fuse) - headFloat()) * BLOCK_SECONDS
        const think = left < 7 ? 400 + Math.random() * 600 : Math.random() < 0.18 ? 4500 + Math.random() * 2500 : 1300 + Math.random() * 3200
        once(id, think, async () => {
          const cur = t.g?.current
          if (!cur || cur.puffer !== c.puffer || cur.holder !== c.holder) return
          const to = pickTarget(allowedTargets(cur), cur.holder)
          if (!to) return
          t.throwing = { from: cur.holder, to, at: performance.now(), puffer: cur.puffer }
          sfx.whoosh?.()
          try { await crewCall({ op: "pass", bot: cur.holder, table: t.key, puffer: cur.puffer, round: cur.round, to }) }
          catch (e) { if (t.throwing?.from === cur.holder) t.throwing = null; throw e }
        })
      }
    }
  }
  const fuse = () => PUFFER.fuseSeconds[0] + Math.random() * (PUFFER.fuseSeconds[1] - PUFFER.fuseSeconds[0])
  /** Who a holder may throw to: anyone still in, except themself, and not straight back to whoever threw it (unless only two are left). */
  function allowedTargets(c) {
    const alive = t.g.alive.map((s) => s.player).filter((p) => p !== c.holder)
    return alive.length > 1 ? alive.filter((p) => p !== c.from) : alive
  }
  /** Bots aim at humans a little more often: it's more fun when it comes to you. */
  function pickTarget(options, holder, serve = false) {
    const opts = options.filter((p) => p !== holder)
    if (!opts.length) return null
    const w = opts.map((p) => (isCrew(p) ? 1 : serve ? 1.5 : 2.4))
    let r = Math.random() * w.reduce((a, b) => a + b, 0)
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i] }
    return opts[opts.length - 1]
  }

  async function writePop(args, winnerHomeKey) {
    const w = await ensureWallet({ quiet: true }); if (!w) return
    let winnerHome = null
    if (winnerHomeKey) try { winnerHome = toThing(await pub().getEntity(winnerHomeKey)) } catch {}
    const r = await popPuffer(w.client, pub(), { ...args, winnerHome })
    log(`Pop recorded${winnerHome ? ` and the pot paid: +${fmtMin(r.minutes)}` : ""}`, r.txHash, true)
    loadSoon(1500)
  }
  async function serve(round, to) {
    const w = await ensureWallet({ quiet: true }); if (!w || !to) return
    t.serving = null; renderPanel()
    const r = await servePuffer(w.client, pub(), { table: t.key, round, to, fuseSeconds: fuse() })
    log(`You served the puffer to ${nameOf(to)}`, r.txHash, true)
    loadSoon(600)
  }
  function startServePick(round) {
    if (t.serving?.round === round || t.duty.has(`serve:${round}`)) return
    t.duty.add(`serve:${round}`)
    t.serving = { round, until: Date.now() + 7000 }
    renderPanel()
    t.serving.timer = setTimeout(() => {
      if (t.serving?.round !== round) return
      serve(round, pickTarget(t.g.alive.map((s) => s.player), me(), true)).catch((e) => toast(`Couldn't serve: ${esc(e.shortMessage || e.message)}`))
    }, 7000)
  }

  // ---------- your moves ----------

  async function throwTo(to) {
    const c = t.g?.current
    if (!c || c.holder !== me() || t.throwing?.from === me()) return
    if (!allowedTargets(c).includes(to)) return toast(to === c.from ? `No passing straight back to ${esc(nameOf(to))}.` : "They're out.", 2200)
    t.throwing = { from: me(), to, at: performance.now(), puffer: c.puffer, mine: true }
    sfx.whoosh?.()
    renderStatus()
    try {
      const w = await ensureWallet({ quiet: true })
      const r = await passPuffer(w.client, { table: t.key, puffer: c.puffer, round: c.round, to })
      t.passTx.add(r.txHash)
      log(`You passed to ${nameOf(to)}`, r.txHash, true)
    } catch (e) {
      const msg = String(e.shortMessage || e.message)
      t.throwing = null
      toast(/not.*owner|expired|not found|does not exist/i.test(msg) ? "Too late: it popped before your pass landed." : `Pass failed: ${esc(msg.slice(0, 140))}`, 4000)
      renderStatus()
    }
  }

  /** You need a house to stake: go move in, then come straight back to this table. */
  function goBuild() {
    try { localStorage.setItem("tideland.next", t.key ? `t:${t.key}` : "play") } catch {}
    close(); house.openBuild()
  }

  async function host() {
    if (t.busy) return
    const homeKey = house.myHome(), home = homeKey && state.things.get(homeKey)
    if (!home || home.expiresAt <= headNow()) return goBuild()
    t.busy = true; renderPanel()
    try {
      const w = await ensureWallet({ quiet: false }); if (!w) throw new Error("no wallet")
      const r = await openTable(w.client, pub(), { home, name: `${home.data.islander || "An islander"}'s table` })
      await open(r.tableKey)
      log("You opened a table and staked 2 h of your house", r.txHash, true)
      await callCrew(3)
    } catch (e) { toast(`Couldn't open a table: ${esc(e.shortMessage || e.message)}`, 6000) }
    t.busy = false; renderPanel()
  }
  async function callCrew(n) {
    t.calling = true; renderPanel()
    try {
      await loadCrew()
      const j = await crewCall({ op: "fill", table: t.key, count: n })
      for (const a of j.seated ?? []) t.crew.add(lc(a))
      log(`${(j.seated ?? []).length} of the island crew sat down`, null)
    } catch (e) { toast(`The crew couldn't come: ${esc(e.message)}`, 5000) }
    t.calling = false
    loadSoon(1800); setTimeout(load, 5000)
  }
  async function sit() {
    const homeKey = house.myHome(), home = homeKey && state.things.get(homeKey)
    if (!home || home.expiresAt <= headNow()) return goBuild()
    t.busy = true; renderPanel()
    try {
      const w = await ensureWallet({ quiet: false })
      const r = await takeSeat(w.client, { table: t.key, home })
      log("You sat down and staked 2 h of your house", r.txHash, true)
      loadSoon(1200)
    } catch (e) { toast(`Couldn't sit: ${esc(e.shortMessage || e.message)}`, 5000) }
    t.busy = false; renderPanel()
  }
  async function start() {
    if (t.busy || !t.g || t.g.seats.length < 2) return
    t.busy = true; renderPanel()
    try { await serve(1, pickTarget(t.g.seats.map((s) => s.player).filter((p) => p !== me()), me(), true)) }
    catch (e) { toast(`Couldn't serve: ${esc(e.shortMessage || e.message)}`, 5000) }
    t.busy = false
  }

  // ---------- live: socket events, fed in by main.js ----------

  function onEvent(e) {
    if (!t.active || !t.key) return
    if (e.blockNumber && e.blockNumber > headSync.block) headSync = { block: e.blockNumber, at: Date.now() }
    t.eventAt = Date.now()
    const known = t.g && [t.g.current?.puffer, ...t.g.pops.map((p) => p.puffer)].includes(lc(e.entityKey))
    if (e.type === "OwnershipTransferred" && known) {
      t.passTx.add(e.transactionHash)
      t.live.push({ puffer: lc(e.entityKey), creator: lc(e.previousOwner), to: lc(e.newOwner), createdAt: e.blockNumber })
      const from = lc(e.previousOwner), to = lc(e.newOwner)
      t.flights.push({ from, to, at: performance.now() })
      if (t.throwing?.from === from) t.throwing = null
      sfx.catch?.()
      if (from !== me()) log(`${nameOf(from)} passed to ${nameOf(to)}`, e.transactionHash)
      update()
    } else if (e.type === "EntityCreated" || e.type === "OwnershipTransferred") {
      // a pass record rides with its ownership change; anything else (seat, serve, pop, win) needs a re-read
      setTimeout(() => { if (!t.passTx.has(e.transactionHash)) loadSoon(500) }, 250)
    }
  }

  // ---------- the panel (DOM) ----------

  function log(text, tx, mine = false, entity = null) {
    t.log.unshift({ text, tx, mine, entity, at: Date.now() })
    t.log = t.log.slice(0, 9)
    $("pp-log").innerHTML = t.log.map((l) => `<li class="${l.mine ? "mine" : ""}">${esc(l.text)}${l.tx ? ` <a href="${explorer}/tx/${l.tx}" target="_blank" rel="noopener">tx</a>` : l.entity ? ` <a href="${explorer}/entity/${l.entity}" target="_blank" rel="noopener">entity</a>` : ""}</li>`).join("")
  }

  function renderStatus() {
    const el = $("pp-status"), g = t.g
    if (!g || !t.key) { el.innerHTML = ""; return }
    const c = g.current
    let html = ""
    if (g.phase === "lobby") html = `<b>${g.seats.length} at the table</b><span>pot ${fmtMin(g.pot)}</span>`
    else if (c) {
      if (t.throwing?.mine) html = `<b class="go">Throwing to ${esc(nameOf(t.throwing.to))}…</b><span>sealing on Arkiv</span>`
      else if (c.holder === me()) html = `<b class="hot">YOU HAVE THE PUFFER</b><span>tap someone to pass it</span>`
      else html = `<b>${esc(nameOf(c.holder))} has it</b><span>round ${c.round} · ${g.alive.length} left · pot ${fmtMin(g.pot)}</span>`
    } else if (g.phase === "between" && g.last) html = `<b class="hot">${esc(nameOf(g.last.holder))} popped!</b><span>${lc(g.last.holder) === me() ? "Your" : "Their"} house floods for ${PUFFER.floodSeconds / 3600} h</span>`
    else if (g.phase === "done") html = `<b class="go">${esc(nameOf(g.winner.player))} ${g.winner.player === me() ? "win" : "wins"}!</b><span>+${fmtMin(g.win ? Number(g.win.attrs.minutes) : g.pot)} on their house</span>`
    el.innerHTML = html
  }

  function renderPanel() {
    renderStatus()
    const el = $("pp-panel"), g = t.g
    const homeKey = house.myHome(), home = homeKey && state.things.get(homeKey)
    const hasHome = home && home.expiresAt > headNow() && same(home.owner, state.wallet?.address ?? home.owner)
    $("pp-top-info").innerHTML = g && t.key ? `${g.phase === "lobby" ? "lobby" : `round <b>${g.phase === "done" ? g.pops.length : g.round}</b>`} · pot <b>${fmtMin(g.pot)}</b>` : ""
    if (!t.key) {
      el.className = "pp-panel card intro"
      const flood = hasHome && floodOf([...state.things.values()].filter((x) => x.home === homeKey), headNow())
      el.innerHTML = `<div class="eyebrow">Tideland · Puffer Pass</div>
        <h2>Pass the puffer before it pops</h2>
        <ul class="howto">
          <li><span>🐡</span><div>The puffer is an Arkiv entity. <b>Its expiry is the fuse.</b> Whoever holds it when it expires is out. No server decides.</div></li>
          <li><span>🏠</span><div>Everyone stakes <b>2 h of their house</b>. The last islander standing takes the whole pot onto their house.</div></li>
          <li><span>🌊</span><div>Pop and your house <b>floods for 6 h</b>: nobody can shore it up until the water drains.</div></li>
        </ul>
        ${hasHome ? `<div class="pp-you"><img src="${spriteUrl(poseSprite(home.look, flood ? "sad" : "happy"))}" alt="" /><div><b>${esc(home.data.islander || "Your islander")}</b><span>house above the tide for ${blocksToText(home.expiresAt - headNow())}${flood ? ` · <em class="sink">flooded</em>` : ""}</span></div></div>
          <button class="primary cta-big" data-pp="host" ${t.busy ? "disabled" : ""}>${t.busy ? "Opening a table…" : "Start a table"}</button>
          <p class="note small">The island crew (three bots with houses of their own) will sit with you. Share the link and friends can take a seat instead.</p>`
        : `<button class="primary cta-big" data-pp="build">Move in an islander to play</button><p class="note small">You need a house to stake. Moving in takes one transaction.</p>`}
        ${t.openTables.length ? `<h3>Tables on the island</h3><ol class="pp-tables">${t.openTables.map((x) => `<li><b>${esc(x.data.name || "A table")}</b><span>opened ${blocksToText(headNow() - x.createdAt)} ago</span><button class="ghost" data-pp-open="${x.key}">Look</button></li>`).join("")}</ol>` : ""}`
      return
    }
    if (!g) { el.className = "pp-panel card"; el.innerHTML = `<p class="note">Reading the table from Arkiv…</p>`; return }
    const mine = mySeat(), isHost = g.seats[0]?.player === me()
    const url = `${location.origin}/?t=${t.key}`
    el.className = `pp-panel card ${g.phase}`
    if (g.phase === "lobby") {
      el.innerHTML = `<div class="eyebrow">Waiting at the table</div>
        <h2>${esc(t.table?.data?.name || "A table")}</h2>
        <p class="note">${g.seats.length} of ${PUFFER.maxSeats} seats · each stakes 2 h · pot <b>${fmtMin(g.pot)}</b></p>
        ${mine ? "" : hasHome ? `<button class="primary cta-big" data-pp="sit" ${t.busy ? "disabled" : ""}>Take a seat · stake 2 h</button>` : `<button class="primary cta-big" data-pp="build">Move in an islander to play</button>`}
        ${isHost ? `<div class="row"><button class="primary cta-big" data-pp="start" ${g.seats.length < 2 || t.busy ? "disabled" : ""}>${g.seats.length < 2 ? "Waiting for someone to sit…" : "Serve the first puffer"}</button>
          <button class="ghost" data-pp="crew" ${t.calling || g.seats.length >= PUFFER.maxSeats ? "disabled" : ""}>${t.calling ? "Calling the crew…" : "+ Call a bot"}</button></div>` : mine ? `<p class="note">Waiting for ${esc(g.seats[0]?.name)} to serve the first puffer.</p>` : ""}
        <div class="linkbox"><input readonly value="${url}" onclick="this.select()" /><button class="ghost" data-pp="copy" data-url="${url}">Copy invite</button></div>`
    } else if (g.phase === "live") {
      el.innerHTML = mine && !t.g.out.has(me()) ? `<p class="note small">Tap an islander to throw. Every pass is a signed Arkiv transaction from your key; it lands in about a block. <b>Hold it too long and the network pops it on you.</b></p>`
        : mine ? `<p class="note small">You're out. Watch who's next.</p>` : `<p class="note small">You're watching. Every throw is an <code>ownership change</code> on Arkiv.</p>`
    } else if (g.phase === "between") {
      const pick = t.serving && g.last?.holder === me()
      el.innerHTML = pick ? `<div class="eyebrow">Revenge</div><h3>You popped, so you serve the next one. Who gets it?</h3>
        <div class="pp-picks">${g.alive.map((s) => `<button class="keeper" data-pp-serve="${s.player}"><img src="${spriteUrl(poseSprite(s.look, "happy"))}" alt="" /><b>${esc(s.name)}</b></button>`).join("")}</div>
        <p class="note small">Picking one for you in a few seconds.</p>`
        : `<p class="note">${esc(nameOf(g.last.holder))} serves the next puffer…</p>`
    } else if (g.phase === "done") {
      const w = g.winner, iWon = w.player === me()
      el.innerHTML = `<div class="eyebrow">Last islander standing</div>
        <h2>${iWon ? "You take the pot!" : `${esc(w.name)} takes the pot`}</h2>
        <p class="note">${g.win ? `+<b>${fmtMin(Number(g.win.attrs.minutes))}</b> was added to ${iWon ? "your" : "their"} house, in the same transaction as the win record.` : "Paying the pot…"} ${mine && !iWon ? `Your house floods for ${PUFFER.floodSeconds / 3600} h.` : ""}</p>
        <div class="row"><button class="primary cta-big" data-pp="again">Play again</button><button class="ghost" data-pp="leave">Back to the island</button></div>
        ${g.win ? `<p class="note small"><a href="${explorer}/entity/${g.win.key}" target="_blank" rel="noopener">See the win record</a> · <a href="${explorer}/entity/${w.home}" target="_blank" rel="noopener">their house</a></p>` : ""}`
    }
  }

  document.addEventListener("click", (e) => {
    if (!t.active) return
    const s = e.target.closest("[data-pp-serve]"); if (s) { clearTimeout(t.serving?.timer); const round = t.serving?.round; t.serving = null; return serve(round, s.dataset.ppServe).catch((er) => toast(esc(er.message))) }
    const o = e.target.closest("[data-pp-open]"); if (o) return open(o.dataset.ppOpen)
    const a = e.target.closest("[data-pp]")?.dataset.pp
    if (!a) return
    if (a === "host") host()
    else if (a === "sit") sit()
    else if (a === "start") start()
    else if (a === "crew") callCrew(1)
    else if (a === "leave") close()
    else if (a === "build") goBuild()
    else if (a === "again") open(null).then(host)
    else if (a === "lobby") open(null)
    else if (a === "copy") { navigator.clipboard?.writeText(e.target.dataset.url); toast("Invite copied. Whoever opens it can take a seat.", 3000) }
  })

  // ---------- the stage (canvas) ----------

  const imgs = new Map(), lastHits = new Map()
  const sprite = (name) => {
    if (!imgs.has(name)) { const i = new Image(); i.src = spriteUrl(name); imgs.set(name, i) }
    const i = imgs.get(name)
    return i.complete && i.naturalWidth ? i : null
  }
  let W = 0, H = 0, DPR = 1
  function resize() {
    DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight
    canvas.width = W * DPR; canvas.height = H * DPR; canvas.style.width = W + "px"; canvas.style.height = H + "px"
  }
  addEventListener("resize", () => { if (t.active) resize() })

  /** Where everyone sits: you at the front, the rest around an oval on the sand. */
  function layoutSeats() {
    const g = t.g, seats = g?.seats ?? []
    const narrow = W < 720
    const cx = W / 2, cy = narrow ? H * 0.48 : H * 0.57, rx = Math.min(W * (narrow ? 0.36 : 0.34), 470), ry = Math.min(H * (narrow ? 0.15 : 0.17), narrow ? rx : rx * 0.55)
    const meIdx = Math.max(0, seats.findIndex((s) => s.player === me()))
    const n = Math.max(seats.length, 1)
    const at = new Map()
    seats.forEach((s, i) => {
      const k = (i - meIdx + n) % n
      const a = Math.PI / 2 + (2 * Math.PI * k) / n
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry
      const depth = (y - (cy - ry)) / (2 * ry || 1)
      at.set(s.player, { x, y, s: (narrow ? 0.48 : 0.68) + depth * (narrow ? 0.24 : 0.3), seat: s })
    })
    return { at, cx, cy, rx, ry }
  }

  function frame(now) {
    t.raf = requestAnimationFrame(frame)
    if (!t.active) return
    const dt = Math.min(0.05, (now - (t.lastFrame ?? now)) / 1000); t.lastFrame = now; t.anim += dt
    // the fuse runs out between socket events: notice it locally, then confirm from the records
    if (t.throwing && now - t.throwing.at > 12000) t.throwing = null
    const c = t.g?.current
    if (c && headFloat() >= Number(c.fuse) && !t.duty.has(`fuse:${c.puffer}`)) {
      t.duty.add(`fuse:${c.puffer}`)
      update()
      setTimeout(load, 1600); setTimeout(load, 4200)
    }
    if (c && now - t.lastTick > tickGap(c)) { t.lastTick = now; sfx.tick?.(swell(c), c.holder === me()) }
    if (t.serving) { const el = $("pp-panel").querySelector(".pp-picks + p"); if (el) el.textContent = `Picking one for you in ${Math.max(0, Math.ceil((t.serving.until - Date.now()) / 1000))} s.` }
    draw(now)
  }
  const swell = (c) => Math.max(0, Math.min(1, (headFloat() - Number(c.servedAt)) / Math.max(1, Number(c.fuse - c.servedAt))))
  const tickGap = (c) => 900 - swell(c) * 720

  function draw(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    beach(now)
    if (!t.g || !t.key) { idlePuffer(now); return }
    const L = layoutSeats(), g = t.g, c = g.current
    // targets you can throw to
    const targets = c && c.holder === me() && !t.throwing ? new Set(allowedTargets(c)) : new Set()
    const order = [...L.at.entries()].sort((a, b) => a[1].y - b[1].y)
    for (const [p, a] of order) islander(p, a, now, targets.has(p), g)
    // the puffer: in someone's hands, or in the air
    if (c) {
      const fl = t.flights[t.flights.length - 1]
      let pos = handsOf(L.at.get(c.holder))
      if (t.throwing && L.at.get(t.throwing.to) && L.at.get(t.throwing.from)) {
        // until the pass is sealed the puffer is still the thrower's: it stays in their hands, aimed
        const a = handsOf(L.at.get(t.throwing.from)), b = handsOf(L.at.get(t.throwing.to))
        ctx.save(); ctx.setLineDash([6, 8]); ctx.lineDashOffset = -now / 30; ctx.strokeStyle = "rgba(180,85,46,.7)"; ctx.lineWidth = 3
        ctx.beginPath(); for (let k = 0; k <= 1.001; k += 0.05) { const q = arc(a, b, k); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y) } ctx.stroke(); ctx.restore()
        const wind = Math.sin(now / 90) * 6
        pos = { x: a.x + wind, y: a.y - 6 }
      } else if (fl && now - fl.at < 520 && L.at.get(fl.from) && L.at.get(fl.to)) {
        const a = handsOf(L.at.get(fl.from)), b = handsOf(L.at.get(fl.to))
        pos = arc(a, b, (now - fl.at) / 520)
      }
      if (pos) puffer(pos.x, pos.y, swell(c), now, c.holder === me(), 0.55 + 0.5 * (L.at.get(c.holder)?.s ?? 1))
    }
    // pops and splashes
    t.fx = t.fx.filter((f) => now - f.at < 1600)
    for (const f of t.fx) popFx(f, now, L)
  }

  const handsOf = (a) => (a ? { x: a.x, y: a.y - 135 * a.s } : null)
  const arc = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(Math.PI * k) * 120 })

  let sand = null
  function beach(now) {
    if (!sand || sand.w !== W || sand.h !== H) {
      sand = document.createElement("canvas"); sand.w = W; sand.h = H; sand.width = W; sand.height = H
      const s = sand.getContext("2d")
      const gr = s.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#f6ead0"); gr.addColorStop(1, "#ead3a6"); s.fillStyle = gr; s.fillRect(0, 0, W, H)
      for (let i = 0; i < W * H / 900; i++) { s.fillStyle = `rgba(${150 + Math.random() * 60},${120 + Math.random() * 40},80,${Math.random() * 0.12})`; s.fillRect(Math.random() * W, Math.random() * H, 2, 2) }
    }
    ctx.drawImage(sand, 0, 0, W, H)
    const top = H * 0.2
    const sky = ctx.createLinearGradient(0, 0, 0, top); sky.addColorStop(0, "#9fd3dc"); sky.addColorStop(1, "#5fb0b4")
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, top)
    // the tide line, breathing
    const tw = now / 1000
    ctx.beginPath(); ctx.moveTo(0, 0)
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, top + Math.sin(x / 70 + tw * 1.3) * 7 + Math.sin(tw * 0.5) * 10)
    ctx.lineTo(W, 0); ctx.closePath(); ctx.fillStyle = "#4aa3a8"; ctx.fill()
    ctx.beginPath()
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, top + 6 + Math.sin(x / 70 + tw * 1.3) * 7 + Math.sin(tw * 0.5) * 10)
    ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 4; ctx.stroke()
  }

  function islander(p, a, now, targetable, g) {
    const s = a.seat, out = g.out.has(p), c = g.current
    const holding = c?.holder === p && !(t.throwing?.from === p)
    const winner = g.winner?.player === p
    const mood = out ? "sleeping" : winner ? "waving" : holding ? "sad" : t.throwing?.from === p ? "waving" : "happy"
    const img = sprite(poseSprite(s.look, mood)) ?? sprite(s.look)
    const h = (out ? 80 : 170) * a.s
    const bob = out ? 0 : Math.sin(now / 380 + a.x) * 2 + (winner ? Math.abs(Math.sin(now / 220)) * -14 : 0)
    const shake = holding ? Math.sin(now / 30) * (1 + swell(c) * 3) : 0
    // shadow, and a puddle for the popped
    ctx.fillStyle = out ? "rgba(74,163,168,.45)" : "rgba(80,60,30,.18)"
    ctx.beginPath(); ctx.ellipse(a.x, a.y + 4, (out ? 70 : 42) * a.s, (out ? 20 : 12) * a.s, 0, 0, Math.PI * 2); ctx.fill()
    if (targetable) {
      const hot = t.hover === p
      ctx.strokeStyle = hot ? "#b4552e" : "rgba(180,85,46,.55)"; ctx.lineWidth = hot ? 4 : 2.5; ctx.setLineDash(hot ? [] : [8, 6])
      ctx.beginPath(); ctx.ellipse(a.x, a.y + 4, 56 * a.s, 17 * a.s, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
    }
    if (img) {
      const w = h * (img.naturalWidth / img.naturalHeight)
      ctx.globalAlpha = out ? 0.6 : 1
      ctx.drawImage(img, a.x - w / 2 + shake, a.y - h + bob, w, h)
      ctx.globalAlpha = 1
    }
    // name tag
    const you = p === me()
    const label = `${you ? "You" : s.name}${isCrew(p) ? " ·bot" : ""}`
    ctx.font = `600 ${Math.round(13 * Math.max(0.85, a.s))}px "Albert Sans", system-ui`
    const tw = ctx.measureText(label).width + 16
    ctx.fillStyle = you ? "#1f6e68" : out ? "rgba(27,43,42,.35)" : "rgba(251,252,250,.92)"
    roundRect(a.x - tw / 2, a.y + 12, tw, 22, 11); ctx.fill()
    ctx.fillStyle = you ? "#fff" : out ? "#fff" : "#1b2b2a"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
    ctx.fillText(label, a.x, a.y + 23.5)
    const home = state.things.get(s.home)
    const sub = out ? "🌊 flooded 6 h" : home ? `🏠 ${blocksToText(home.expiresAt - headNow())}` : ""
    if (sub) { ctx.font = `500 11px "IBM Plex Mono", monospace`; ctx.fillStyle = out ? "#2b7c80" : "#5e7472"; ctx.fillText(sub, a.x, a.y + 44) }
    lastHits.set(p, { x0: a.x - 50 * a.s, x1: a.x + 50 * a.s, y0: a.y - (out ? 80 : 170) * a.s, y1: a.y + 30 })
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }

  function puffer(x, y, k, now, mine, scale = 1) {
    // swells from a slim fish to a spiky ball; trembles faster as the fuse runs down
    const full = sprite("puffer-full"), calm = sprite("puffer-calm")
    const size = (64 + k * 70) * scale
    const tremble = k > 0.55 ? Math.sin(now / (60 - k * 40)) * (k - 0.5) * 8 : 0
    const pulse = 1 + Math.sin(now / (260 - k * 200)) * (0.03 + k * 0.06)
    const s = size * pulse
    if (k > 0.75) { // a red warning glow
      const gl = ctx.createRadialGradient(x, y, s * 0.2, x, y, s * 1.1); gl.addColorStop(0, `rgba(220,70,40,${(k - 0.75) * 1.4})`); gl.addColorStop(1, "rgba(220,70,40,0)")
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, s * 1.1, 0, Math.PI * 2); ctx.fill()
    }
    const img = k < 0.4 ? calm ?? full : full ?? calm
    if (img) {
      const w = s * (img.naturalWidth / img.naturalHeight)
      ctx.save(); ctx.translate(x + tremble, y); ctx.rotate(Math.sin(now / 500) * 0.08)
      ctx.drawImage(img, -w / 2, -s / 2, w, s)
      ctx.restore()
    } else {
      ctx.fillStyle = `hsl(${40 - k * 30},90%,60%)`; ctx.beginPath(); ctx.arc(x + tremble, y, s / 2, 0, Math.PI * 2); ctx.fill()
    }
    if (mine) {
      ctx.font = `700 13px "IBM Plex Mono", monospace`; ctx.fillStyle = "#b4552e"; ctx.textAlign = "center"
      ctx.fillText("PASS IT!", x, y - s / 2 - 12)
    }
  }

  function idlePuffer(now) {
    const top = $("pp-panel").getBoundingClientRect().top
    const x = W / 2, y = Math.min(H * 0.13, top - 60) + Math.sin(now / 600) * 8
    const k = (Math.sin(now / 1400) + 1) / 2
    puffer(x, y, k * 0.9, now, false)
  }

  function burst(player) {
    t.fx.push({ player, at: performance.now(), bits: Array.from({ length: 26 }, () => ({ a: Math.random() * Math.PI * 2, v: 160 + Math.random() * 260, r: 3 + Math.random() * 6, c: Math.random() < 0.6 ? "#f2a33a" : "#7fc4c8" })) })
    sfx.pop?.()
    if (lc(player) === me()) navigator.vibrate?.(300)
  }
  function popFx(f, now, L) {
    const a = L.at.get(f.player); if (!a) return
    const p = handsOf(a), k = (now - f.at) / 1600
    ctx.globalAlpha = Math.max(0, 1 - k)
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 6 * (1 - k); ctx.beginPath(); ctx.arc(p.x, p.y, 20 + k * 220, 0, Math.PI * 2); ctx.stroke()
    for (const b of f.bits) { ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(p.x + Math.cos(b.a) * b.v * k, p.y + Math.sin(b.a) * b.v * k + 260 * k * k, b.r * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill() }
    ctx.font = `800 ${Math.round(46 + 30 * Math.min(1, k * 4))}px "Albert Sans", system-ui`; ctx.fillStyle = "#b4552e"; ctx.textAlign = "center"
    ctx.fillText("POP!", p.x, p.y - 40 - k * 60)
    ctx.globalAlpha = 1
  }

  // pointer: hover and throw
  const hitAt = (x, y) => { if (!t.g) return null; for (const [p, a] of layoutSeats().at) { const L = lastHits.get(p); if (L && x >= L.x0 && x <= L.x1 && y >= L.y0 && y <= L.y1) return p } return null }
  canvas.addEventListener("pointermove", (e) => { t.hover = hitAt(e.clientX, e.clientY); canvas.style.cursor = t.hover && t.g?.current?.holder === me() ? "pointer" : "default" })
  canvas.addEventListener("pointerdown", (e) => { const p = hitAt(e.clientX, e.clientY); if (p && p !== me()) throwTo(p) })
  addEventListener("keydown", (e) => {
    if (!t.active || !t.g?.current || t.g.current.holder !== me()) return
    const n = Number(e.key); if (!n) return
    const opts = allowedTargets(t.g.current); if (opts[n - 1]) throwTo(opts[n - 1])
  })

  // safety net: if the socket goes quiet mid-game, re-read every few seconds
  setInterval(() => { if (t.active && t.key && t.g?.phase !== "done" && Date.now() - Math.max(t.loadedAt, t.eventAt ?? 0) > 9000) load() }, 3000)
  setInterval(() => { if (t.active) syncHead() }, 15000)

  return { open, close, onEvent, get active() { return t.active } }
}
