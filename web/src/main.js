import "./style.css"
import {
  MATERIALS, INSCRIPTION_SPANS, DAY_BLOCKS, publicClient, collect, worldQuery, tideQuery, legacyQuery, estateQuery,
  guildsQuery, toThing, layout, isBudgetError, lifeLeft, blocksToText, claimAndBuild, build, renew, tend, inscribe, sell,
} from "../../shared/tideland.js"
import { createView, draw, loadSprites, spriteUrl, characterFor } from "./render.js"
import { localWallet, injectedWallet, balanceOf, drip } from "./wallet.js"
import { createRun } from "./run.js"
import { createHouse } from "./house.js"

const EXPLORER = "https://tiramisu.explorer.arkiv.network"
const REPO = "https://github.com/neromtoobad/tideland"
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "–")
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase()

// Reads go straight to Arkiv's public RPC (or any RPC passed as ?rpc=). Only if this visitor's
// anonymous budget is exhausted do we fall back to the read-only relay, and the page says so.
const rpcParam = new URLSearchParams(location.search).get("rpc")
let pub = publicClient(rpcParam ? { rpc: rpcParam } : {})
let relayed = false
async function reading(fn) {
  try { return await fn() } catch (e) {
    if (relayed || !isBudgetError(e)) throw e
    relayed = true
    pub = publicClient({ rpc: `${location.origin}/api/rpc` })
    $("stat-relay").hidden = false
    return fn()
  }
}
const state = {
  things: new Map(), cells: new Map(), guilds: new Map(), tide: [],
  head: 0n, headAt: Date.now(), wallet: null, balance: null, busy: false, lastQuery: "",
  lost: [], // structures seen this session whose expiry has passed: the tide took them
  tenders: new Map(), // entityKey -> address that last extended it (read from the tx, see friction.md)
}
const view = createView($("world"))
if (import.meta.env.DEV) window.__tl = { state, view }

// ---------------- data ----------------

function rebuild() {
  const head = headNow()
  for (const t of state.things.values()) {
    if (t.kind === "structure" && t.expiresAt <= head && !state.lost.some((l) => l.key === t.key)) {
      state.lost.unshift({ ...t, sankAt: Date.now() }); view.splash?.(t)
    }
  }
  state.lost = state.lost.slice(0, 8)
  const all = [...state.things.values()].filter((t) => t.expiresAt > head)
  state.cells = layout(all)
  state.guilds = new Map(all.filter((t) => t.kind === "guild").map((g) => [g.key, g]))
  const standing = all.filter((t) => t.kind === "structure").length
  $("stat-live").textContent = standing
  $("stat-tide").textContent = state.tide.filter((t) => t.expiresAt > headNow() && t.kind !== "run").length
  renderTide()
  if (view.selected) renderInspector({ soft: true })
}

const headNow = () => state.head + BigInt(Math.floor((Date.now() - state.headAt) / 2000))

const refresh = () => reading(refreshNow)
async function refreshNow() {
  const timing = await pub.getBlockTiming()
  state.head = timing.currentBlock; state.headAt = Date.now()
  $("stat-block").textContent = state.head.toLocaleString()
  let [things, tide] = await Promise.all([collect(worldQuery(pub)), collect(tideQuery(pub, state.head))])
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
    things = (await import("./dev/mock.js")).mockThings(state.head)
    tide = things.filter((t) => t.expiresAt < state.head + DAY_BLOCKS)
  }
  state.lastQuery = tideQuery(pub, state.head).toString()
  state.things = new Map(things.map((t) => [t.key, t]))
  state.tide = tide.sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1))
  rebuild()
}


function watchLive() {
  // A real socket: WebSocket transport and no fromBlock, so events are pushed rather than polled.
  const ws = publicClient({ ws: true })
  // Each arkiv_query costs 100 units of the visitor's budget, so a burst of events triggers ONE
  // debounced re-read of the world (2 queries) instead of one getEntity per event.
  let pending = null
  const touch = () => {
    if (runner.active) return // during a run, events update expiries in place: no re-reads
    clearTimeout(pending); pending = setTimeout(() => refresh().catch(() => {}), 2500)
  }
  ws.watchEntityEvents({
    onEntityCreated: touch,
    onExpiryExtended: async (e) => {
      runner.onExtended(e.entityKey, e.expiresAt) // the event carries the new expiry: apply it directly
      touch(e)
      // The event names the owner, not whoever extended it. For a lighthouse anyone can tend, read the sender.
      try {
        const tx = await pub.getTransaction({ hash: e.transactionHash })
        state.tenders.set(e.entityKey, tx.from)
        house.onExtended(e.entityKey, e.expiresAt, tx.from)
        const t = state.things.get(e.entityKey)
        ripple(e.entityKey, same(tx.from, t?.owner) ? "renewed by its holder" : `tended by ${short(tx.from)}`)
      } catch { ripple(e.entityKey, "renewed") }
    },
    onOwnershipTransferred: touch, onEntityPatched: touch,
    onEntityDeleted: (e) => { state.things.delete(e.entityKey); rebuild(); touch() },
    onError: (err) => console.warn("watch", err.message),
  })
}

function ripple(key, what) {
  if (runner.active) return
  const t = state.things.get(key)
  if (t && t.x !== undefined && t.kind === "structure") toast(`${esc(t.data.name || MATERIALS[t.material]?.label)} at ${t.x},${t.y} was ${what}`)
}

// ---------------- tide map ----------------

function thingLabel(t) {
  if (t.kind === "home") return `${t.data.name || "A house"} (house)`
  if (t.kind === "structure") return t.data.name || MATERIALS[t.material]?.label
  if (t.kind === "parcel") return (t.data.name || "Unbuilt land") + " (land)"
  if (t.kind === "inscription") return `“${(t.data.text || "").slice(0, 28)}”`
  if (t.kind === "guild") return `${t.data.name} charter`
  return t.kind
}
function thingSprite(t) {
  if (t.kind === "home") return spriteUrl(t.style || "pine")
  if (t.kind === "structure") return spriteUrl(t.material)
  if (t.kind === "inscription") return spriteUrl("inscription")
  if (t.kind === "guild") return spriteUrl(characterFor(t) || "lamplighter")
  return spriteUrl("plot")
}

function renderTide() {
  $("tide-query").textContent = state.lastQuery
  const head = headNow()
  const items = state.tide.filter((t) => t.expiresAt > head && t.kind !== "run").slice(0, 40)
  $("tide-list").innerHTML = items.length ? items.map((t) => `
    <li data-key="${t.key}" class="${t.expiresAt - head > 21600n ? "calm" : ""}">
      <img src="${thingSprite(t)}" alt="" />
      <div><div class="nm">${esc(thingLabel(t))}</div><div class="sub">${t.x !== undefined ? `${t.x},${t.y} · ` : ""}held by ${short(t.owner)}</div></div>
      <div class="t">${blocksToText(t.expiresAt - head)}</div>
    </li>`).join("") : `<li class="empty">Nothing sinks in the next day. The coast is tended.</li>`
  if (state.lost.length) $("tide-list").innerHTML += `<li class="lost-h">Lost to the tide this visit</li>` + state.lost.map((t) => `
    <li class="lost" data-key="${t.key}" data-x="${t.x}" data-y="${t.y}"><img src="${thingSprite(t)}" alt="" /><div><div class="nm">${esc(thingLabel(t))}</div><div class="sub">${t.x},${t.y} · built by ${short(t.creator)}</div></div><div class="t"><a href="${EXPLORER}/entity/${t.key}" target="_blank" rel="noopener">history</a></div></li>`).join("")
}
$("tide-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-key]"); if (!li) return
  const tk = state.things.get(li.dataset.key)
  if (tk?.kind === "home") return house.open(tk.key)
  if (li.classList.contains("lost")) { const x = +li.dataset.x, y = +li.dataset.y; select({ x, y }); view.focus(x, y); return }
  const t = state.things.get(li.dataset.key)
  if (t?.x !== undefined) { select({ x: t.x, y: t.y }); view.focus(t.x, t.y) }
  else if (t?.kind === "guild") showGuild(t)
})

// ---------------- inspector ----------------

function select(cell) {
  const s = cell && state.cells.get(`${cell.x}:${cell.y}`)?.structure
  if (s?.kind === "home") { view.selected = cell; return house.open(s.key) }
  view.selected = cell; renderInspector()
}

function lifeBlock(t) {
  const head = headNow(), left = t.expiresAt - head, frac = lifeLeft(t, head)
  return `<div class="life ${left < DAY_BLOCKS ? "low" : ""}"><span style="width:${(frac * 100).toFixed(1)}%"></span></div>
    <div class="lifeline"><span>sinks in <b>${blocksToText(left)}</b></span><span class="mono">block ${t.expiresAt.toLocaleString()}</span></div>`
}

const who = (addr) => `<a href="#" data-legacy="${addr}">${short(addr)}</a>${same(addr, state.wallet?.address) ? " <span class='badge'>you</span>" : ""}`

let lastSig = ""
function renderInspector({ soft = false } = {}) {
  const el = $("inspector"), sel = view.selected
  if (soft && sel) {
    // Background refreshes must not wipe a half-typed name: skip while the player is using the form,
    // and skip when nothing on this cell changed.
    if (el.contains(document.activeElement) && document.activeElement !== document.body) return
    const c0 = state.cells.get(`${sel.x}:${sel.y}`)
    const sig = JSON.stringify([c0?.parcels, c0?.structures, c0?.inscriptions, state.wallet?.address, state.balance?.text, [...state.tenders]], (k, v) => (typeof v === "bigint" ? v.toString() : v))
    if (sig === lastSig) return
  }
  document.body.classList.toggle("inspecting", !!sel)
  if (!sel) { el.hidden = true; return }
  el.hidden = false
  const c = state.cells.get(`${sel.x}:${sel.y}`) ?? { x: sel.x, y: sel.y, parcels: [], structures: [], inscriptions: [], contested: [], squatters: [] }
  const me = state.wallet?.address
  const s = c.structure, p = c.parcel
  let html = `<button class="close" aria-label="Close" data-act="close">×</button>`

  if (s) {
    const m = MATERIALS[s.material]
    const guild = state.guilds.get(s.guild)
    html += `<div class="hero"><img src="${spriteUrl(s.material)}" alt="" />
      <div><div class="coord">CELL ${c.x},${c.y}</div><h2>${esc(s.data.name || m.label)}</h2>
      <div>${`<span class="badge">${s.material}</span>`}${s.flags?.readonly ? `<span class="badge gold">readonly</span>` : ""}${s.flags?.permissionlessExtension ? `<span class="badge gold">anyone can tend</span>` : ""}${guild ? `<span class="badge">${esc(guild.data.name)}</span>` : ""}</div></div></div>
      ${lifeBlock(s)}
      <dl class="kv">
        <dt>Built by</dt><dd>${who(s.creator)}</dd>
        <dt>Held by</dt><dd>${who(s.owner)}${!same(s.creator, s.owner) ? ` <span class="badge gold">inherited</span>` : ""}</dd>
        ${state.tenders.has(s.key) && !same(state.tenders.get(s.key), s.owner) ? `<dt>Last tended by</dt><dd>${who(state.tenders.get(s.key))}</dd>` : ""}
        <dt>Entity</dt><dd><a href="${EXPLORER}/entity/${s.key}" target="_blank" rel="noopener">${short(s.key)}</a></dd>
      </dl>
      ${s.data.note ? `<p class="note">${esc(s.data.note)}</p>` : ""}
      <p class="note">${esc(m.blurb)}</p>`
  } else if (p) {
    html += `<div class="hero"><img src="${spriteUrl("plot")}" alt="" /><div><div class="coord">CELL ${c.x},${c.y}</div><h2>${esc(p.data.name || "Claimed land")}</h2></div></div>`
  } else {
    html += `<div class="hero"><img src="${spriteUrl("plot")}" alt="" style="opacity:.5" /><div><div class="coord">CELL ${c.x},${c.y}</div><h2>Open coast</h2><p class="note">No live parcel here. Anyone can claim it.</p></div></div>`
  }

  if (p) html += `<div class="section"><h3>The land</h3>${lifeBlock(p)}
    <dl class="kv"><dt>Founded by</dt><dd>${who(p.creator)}</dd><dt>Held by</dt><dd>${who(p.owner)}</dd>
    <dt>Entity</dt><dd><a href="${EXPLORER}/entity/${p.key}" target="_blank" rel="noopener">${short(p.key)}</a></dd></dl></div>`

  if (c.contested?.length) html += `<div class="contest">Contested: ${c.contested.length} later claim${c.contested.length > 1 ? "s" : ""} on this cell (${c.contested.map((x) => short(x.creator)).join(", ")}). The earliest live parcel holds it; the rest go unrenewed.</div>`

  // ----- actions -----
  if (!state.wallet) {
    html += `<div class="section"><p class="note">Pick a wallet to claim, build and tend. A local key lives only in this browser and holds test GLM.</p>
      <div class="row"><button class="primary" data-act="btn-local">Play with a local key</button><button class="ghost" data-act="btn-inj">Use my wallet</button></div></div>`
  } else {
    html += `<div class="mine"><span class="mono small">you · ${short(state.wallet.address)} · ${state.balance?.text ?? "…"}</span>${state.balance && state.balance.wei < 2_000_000_000_000_000n ? `<button class="ghost" data-act="btn-drip">Get test GLM</button>` : ""}</div>`
  }
  if (state.wallet && !p) {
    html += claimForm()
  } else if (state.wallet && same(p.owner, me) && !s) {
    html += buildForm()
  }
  if (state.wallet && s) {
    if (same(s.owner, me)) {
      html += `<div class="section"><h3>Upkeep</h3><p class="note">Renewing sets this ${s.material} back to its full ${blocksToText(BigInt(MATERIALS[s.material].seconds / 2))} and renews the land in the same transaction.</p>
        <button class="primary" data-act="renew">Renew house + land</button></div>
        <div class="section"><h3>Hand it on</h3><p class="note">Ownership moves; the builder's name never does.</p>
        <input id="sell-to" placeholder="0x… new holder" /><button data-act="sell">Transfer land + house</button></div>`
    } else if (s.flags?.permissionlessExtension) {
      html += `<div class="section"><h3>Keep the light lit</h3><p class="note">This lighthouse was created with <b>permissionless extension</b>. You don't own it and can't change it, but you can buy it ${blocksToText(BigInt(MATERIALS.lighthouse.seconds / 2))} more from now.</p>
        <button class="gold" data-act="tend">Tend the light</button></div>`
    } else {
      html += `<div class="section"><p class="note">Only its holder can renew it. If they stop, it sinks, and the land opens up again.</p></div>`
    }
  }
  if (c.inscriptions.length) {
    html += `<div class="section"><h3>Inscribed here</h3>${c.inscriptions.map((i) => `<p class="note">“${esc(i.data.text)}” <br><span class="mono">by ${short(i.creator)} · fades in ${blocksToText(i.expiresAt - headNow())}</span></p>`).join("")}</div>`
  }
  if (state.wallet) html += `<div class="section"><h3>Inscribe</h3><input id="ins-text" maxlength="140" placeholder="A few words for the coast (synthetic only)" />
    <div class="row"><select id="ins-span" style="flex:1">${Object.keys(INSCRIPTION_SPANS).map((k) => `<option value="${k}" ${k === "week" ? "selected" : ""}>remember for a ${k}</option>`).join("")}</select>
    <button data-act="inscribe">Carve</button></div></div>`
  el.innerHTML = html
  const c1 = state.cells.get(`${sel.x}:${sel.y}`)
  lastSig = JSON.stringify([c1?.parcels, c1?.structures, c1?.inscriptions, state.wallet?.address, state.balance?.text, [...state.tenders]], (k, v) => (typeof v === "bigint" ? v.toString() : v))
}

function materialPicker() {
  return `<div class="mats">${Object.entries(MATERIALS).map(([k, m], i) => `
    <button class="mat" data-mat="${k}" aria-pressed="${i === 1}"><img src="${spriteUrl(k)}" alt="" /><div><b>${m.label}</b><span>${blocksToText(BigInt(m.seconds / 2))}</span></div></button>`).join("")}</div>`
}
function guildPicker() {
  const gs = [...state.guilds.values()]
  return `<select id="f-guild"><option value="">No guild</option>${gs.map((g) => `<option value="${g.key}">${esc(g.data.name)}</option>`).join("")}</select>`
}
function claimForm() {
  return `<div class="section"><h3>Claim &amp; build</h3>
    <input id="f-name" maxlength="40" placeholder="Name it (e.g. Saltbreak Cottage)" />
    ${materialPicker()}${guildPicker()}
    <p class="note">Land (14 d) and house are created in <b>one atomic batch</b>: both or neither.</p>
    <button class="primary" data-act="claim">Claim this cell</button></div>`
}
function buildForm() {
  return `<div class="section"><h3>Build on your land</h3><input id="f-name" maxlength="40" placeholder="Name it" />${materialPicker()}${guildPicker()}
    <button class="primary" data-act="build">Build</button></div>`
}

$("inspector").addEventListener("click", async (e) => {
  const mat = e.target.closest("[data-mat]")
  if (mat) { for (const b of $("inspector").querySelectorAll("[data-mat]")) b.setAttribute("aria-pressed", String(b === mat)); return }
  const leg = e.target.closest("[data-legacy]")
  if (leg) { e.preventDefault(); return showLegacy(leg.dataset.legacy) }
  const act = e.target.closest("[data-act]")?.dataset.act
  if (!act) return
  if (act === "close") return select(null)
  if (act.startsWith("btn-")) return walletAction(act)
  const sel = view.selected, c = state.cells.get(`${sel.x}:${sel.y}`)
  const picked = $("inspector").querySelector('[data-mat][aria-pressed="true"]')?.dataset.mat
  const name = $("f-name")?.value.trim() || MATERIALS[picked]?.label || "Land"
  const guild = $("f-guild")?.value || undefined
  const w = state.wallet.client
  await (act === "claim" ? send("Claiming the cell", () => claimAndBuild(w, { x: sel.x, y: sel.y, name, material: picked, guild }, pub))
    : act === "build" ? send("Building", () => build(w, { x: sel.x, y: sel.y, parcelKey: c.parcel.key, name, material: picked, guild }))
    : act === "renew" ? send("Renewing house and land", () => renew(w, { structure: c.structure, parcel: same(c.parcel?.owner, state.wallet.address) ? c.parcel : null }))
    : act === "tend" ? send("Tending the light", () => tend(w, c.structure))
    : act === "sell" ? send("Handing it on", () => sell(w, { parcel: c.parcel, structure: c.structure, to: $("sell-to").value.trim() }))
    : act === "inscribe" ? send("Carving", () => inscribe(w, { x: sel.x, y: sel.y, text: $("ins-text").value.trim() || "Was here.", span: $("ins-span").value }))
    : null)
})

async function send(label, fn) {
  if (state.busy) return
  if (state.balance && state.balance.wei === 0n) return toast(`This wallet has no test GLM yet. Use “Get test GLM” first.`)
  state.busy = true; toast(`${label}… signing on Tiramisu`, 0)
  try {
    const r = await fn()
    const hash = r?.txHash
    toast(`${label}: done. ${hash ? `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">view transaction</a>` : ""}`, 7000)
    // arkiv_query trails the receipt by a few seconds (see friction.md), so read twice.
    await new Promise((r) => setTimeout(r, 2000))
    await refresh(); await updateBalance()
    setTimeout(() => refresh().then(() => renderInspector()).catch(() => {}), 8000)
    document.activeElement?.blur?.(); renderInspector()
  } catch (err) {
    console.error(err)
    toast(`${label} failed: ${esc(err.shortMessage || err.message).slice(0, 220)}`, 9000)
  } finally { state.busy = false }
}

// ---------------- legacy & guild views ($creator / $owner as UX) ----------------

async function showLegacy(address) {
  modal(`<h2>${short(address)}</h2><p class="note">Loading legacy…</p>`)
  const [built, held] = await reading(() => Promise.all([collect(legacyQuery(pub, address)), collect(estateQuery(pub, address))]))
  const q1 = legacyQuery(pub, address).toString(), q2 = estateQuery(pub, address).toString()
  const row = (t) => `<li>${esc(t.data.name || t.material || "land")} · ${t.x},${t.y} · sinks in ${blocksToText(t.expiresAt - headNow())}${t.kind === "structure" && !same(t.owner, address) ? " · <b>now held by " + short(t.owner) + "</b>" : ""}</li>`
  modal(`<h2>${short(address)}${same(address, state.wallet?.address) ? " (you)" : ""}</h2>
    <h3>Legacy: built by this address (${built.length})</h3><p class="note">Filtered by the immutable <code>$creator</code>. Selling a house never removes it from here.</p>
    <pre>${esc(q1)}</pre><ul>${built.map(row).join("") || "<li>Nothing standing.</li>"}</ul>
    <h3>Estate: land held now (${held.length})</h3><pre>${esc(q2)}</pre><ul>${held.map(row).join("") || "<li>No land.</li>"}</ul>`)
}

function showGuild(g) {
  modal(`<h2>${esc(g.data.name)}</h2><p>${esc(g.data.motto || "")}</p>${lifeBlockText(g)}`)
}
const lifeBlockText = (t) => `<p class="note">Charter lapses in <b>${blocksToText(t.expiresAt - headNow())}</b> unless its founder renews it.</p>`

// ---------------- wallet ----------------

async function updateBalance() {
  if (!state.wallet) return
  try {
    state.balance = await reading(() => balanceOf(pub, state.wallet.address))
    $("wallet-bal").textContent = state.balance.text
    $("wallet-dot").className = "dot " + (state.balance.wei > 0n ? "ok" : "low")
  } catch {}
}

function renderWallet() {
  const w = state.wallet
  $("wallet-addr").innerHTML = w ? `${w.kind === "local" ? "local key" : "your wallet"} · <a href="#" data-legacy="${w.address}">${short(w.address)}</a>` : "no wallet"
  $("wallet-actions").innerHTML = w
    ? `<button class="primary" id="btn-drip">Get test GLM</button><button class="ghost" id="btn-switch">${w.kind === "local" ? "Use my wallet" : "Use local key"}</button>`
    : `<button class="primary" id="btn-local">Play with a local key</button><button class="ghost" id="btn-inj">Use my wallet</button>`
}
$("wallet").addEventListener("click", (e) => {
  const leg = e.target.closest("[data-legacy]"); if (leg) { e.preventDefault(); return showLegacy(leg.dataset.legacy) }
  if (e.target.id) walletAction(e.target.id)
})
async function walletAction(id) {
  try {
    if (id === "btn-local" || (id === "btn-switch" && state.wallet?.kind === "injected")) state.wallet = localWallet()
    else if (id === "btn-inj" || id === "btn-switch") state.wallet = await injectedWallet()
    else if (id === "btn-drip") {
      toast("Asking the coast treasury for test GLM…", 0)
      const r = await drip(state.wallet.address)
      toast(`Sent ${r.amount} GLM. <a href="${EXPLORER}/tx/${r.txHash}" target="_blank" rel="noopener">view transfer</a>`, 6000)
      setTimeout(() => updateBalance().then(renderInspector), 2500)
    } else return
    try { localStorage.setItem("tideland.mode", state.wallet.kind) } catch {}
    renderWallet(); await updateBalance(); renderInspector()
  } catch (err) { toast(esc(err.message), 7000) }
}

// ---------------- modals ----------------

function modal(html) { $("modal-body").innerHTML = html; if (!$("modal").open) $("modal").showModal() }
function toast(html, ms = 4500) {
  const el = $("toast"); el.innerHTML = html; el.hidden = false
  clearTimeout(toast.t); if (ms) toast.t = setTimeout(() => { el.hidden = true }, ms)
}

$("btn-how").onclick = () => modal(`<h2>How the tide works</h2>
  <p>Every house, parcel, inscription and guild charter here is an <b>Arkiv entity</b> with an expiry. Nothing deletes them: when the expiry passes, they drop out of every query. That is the tide.</p>
  <p><b>Material is lifetime.</b> ${Object.values(MATERIALS).map((m) => `${m.label} ${blocksToText(BigInt(m.seconds / 2))}`).join(" · ")}. Renewing buys the full span again from now.</p>
  <p><b>Lighthouses are commons.</b> They are created with <i>permissionless extension</i>, so anyone can keep them lit without being able to change them.</p>
  <p><b>Every ruin has an author.</b> The builder is the entity's <code>$creator</code> and never changes; land can be handed on with <code>$owner</code>.</p>
  <p><b>The claim rule:</b> a cell belongs to its oldest live parcel. Later claims are visible as contests.</p>
  <p class="note">There is no Tideland server. This page reads Arkiv directly; the one helper endpoint only tops up test GLM. Full contract: <a href="${REPO}/blob/main/arkiv/schema.md" target="_blank" rel="noopener">schema.md</a>.</p>`)

$("btn-mirror").onclick = () => modal(`<h2>Read the coast without us</h2>
  <p>If this site went dark tomorrow, the world would still be there. Any program can draw it straight from Arkiv:</p>
  <pre>npm i @arkiv-network/sdk viem

import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq } from "@arkiv-network/sdk/query"
import { http } from "viem"

const c = createPublicClient({ chain: tiramisu, transport: http() })
const page = await c.select().where(eq("app","tideland"), eq("world","s1")).limit(200).fetch()
console.log(page.entities)</pre>
  <p>Or run the second client that ships in the repo: <code>node cli/tide.mjs map</code> draws the same coast in your terminal, <code>node cli/tide.mjs tide</code> lists what sinks next.</p>
  <p class="note">The tide-map query this page is running right now:</p><pre>${esc(state.lastQuery)}</pre>`)

// ---------------- Keeper Run ----------------

async function ensureRunWallet({ quiet = false } = {}) {
  // Runs sign a batch every few seconds, so they use the local key (no wallet pop-up per batch).
  if (state.wallet?.kind !== "local") { state.wallet = localWallet(); try { localStorage.setItem("tideland.mode", "local") } catch {} ; renderWallet() }
  await updateBalance()
  if (!state.balance || state.balance.wei < 3_000_000_000_000_000n) {
    if (!quiet) toast("Getting your local key some test GLM…", 0)
    try {
      await drip(state.wallet.address)
      for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 1500)); await updateBalance(); if (state.balance?.wei >= 3_000_000_000_000_000n) break }
    } catch (err) { if (!quiet) toast(`Couldn't top up: ${esc(err.message)}`, 7000); return quiet ? state.wallet : null }
  }
  if (!quiet) $("toast").hidden = true
  return state.wallet
}

const house = createHouse({
  state, view, headNow, pub: () => pub, ensureWallet: ensureRunWallet, toast, explorer: EXPLORER, refresh, short, esc, same,
  onOpen: () => { view.selected = null; renderInspector() },
})
document.addEventListener("click", (e) => { if (e.target.closest("[data-myhome]")) house.open(house.myHome()) })
$("cta-save").onclick = () => {
  const head = headNow()
  const homes = [...state.things.values()].filter((t) => t.kind === "home" && t.expiresAt > head && !same(t.owner, state.wallet?.address))
  homes.sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1))
  if (!homes.length) return toast("No houses are sinking right now. Build one and share it.", 4000)
  house.open(homes[Math.floor(Math.random() * Math.min(3, homes.length))].key)
}

const runner = createRun({
  state, view, headNow, ensureWallet: ensureRunWallet, pub: () => pub, toast, refresh, explorer: EXPLORER,
})

// ---------------- input ----------------

const canvas = $("world")
let drag = null
canvas.addEventListener("pointerdown", (e) => {
  if (runner.active) { runner.pointerDown(e.clientX, e.clientY); canvas.setPointerCapture(e.pointerId); return }
  drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false }; canvas.setPointerCapture(e.pointerId) })
canvas.addEventListener("pointermove", (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; canvas.classList.add("dragging") }
    view.ox = drag.ox + dx; view.oy = drag.oy + dy
  } else view.hover = view.toGrid(e.clientX, e.clientY)
})
canvas.addEventListener("pointerup", (e) => {
  if (runner.active) { runner.pointerUp(); return }
  canvas.classList.remove("dragging")
  if (drag && !drag.moved) select(view.toGrid(e.clientX, e.clientY))
  drag = null
})
canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)) }, { passive: false })
function zoomAt(px, py, f) {
  const z = Math.min(3, Math.max(0.25, view.zoom * f)), k = z / view.zoom
  view.ox = px - (px - view.ox) * k; view.oy = py - (py - view.oy) * k; view.zoom = z
}
$("zoom-in").onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.25)
$("zoom-out").onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 0.8)
$("zoom-fit").onclick = () => view.fit()
addEventListener("resize", () => view.resize())
addEventListener("keydown", (e) => { if (runner.key(e, true)) return; if (e.key === "Escape") select(null) })
addEventListener("keyup", (e) => { runner.key(e, false) })

// ---------------- boot ----------------

let last = performance.now()
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now
  runner.update(dt)
  draw(view, { cells: state.cells, guilds: state.guilds, head: state.head, headAt: state.headAt })
  requestAnimationFrame(frame)
}

;(async () => {
  await loadSprites()
  requestAnimationFrame(frame)
  try { if (localStorage.getItem("tideland.mode") === "local") state.wallet = localWallet() } catch {}
  renderWallet(); updateBalance()
  try { await refresh() } catch (err) { toast(`Could not reach Arkiv: ${esc(err.message)}`, 0) }
  try { watchLive() } catch (err) { console.warn(err) }
  // Live changes arrive on the socket; a slow background re-read is only a safety net. Expiry needs no
  // re-read at all: every frame compares each entity's $expiresAt with the estimated head block.
  setInterval(() => refresh().catch(() => {}), 300000)
  setInterval(() => rebuild(), 10000) // local only: notices what the tide just took
  setInterval(() => updateBalance(), 30000)
  const q = new URLSearchParams(location.search)
  if (q.has("embed")) { state.embed = true; document.body.classList.add("embed") }
  const hk = q.get("h") || location.pathname.match(/^\/h\/(0x[0-9a-fA-F]{64})/)?.[1]
  if (hk) house.open(hk, { push: !location.pathname.startsWith("/h/") })
  if (house.myHome() && !hk) $("cta-home").outerHTML = `<button class="storm-cta" id="cta-home" onclick="void 0" data-myhome="1">Your house <span>see who kept it afloat</span></button>`
  if (q.has("run")) runner.openLobby()
  if (q.has("x") && q.has("y")) { const x = +q.get("x"), y = +q.get("y"); select({ x, y }); view.focus(x, y) }
})()
