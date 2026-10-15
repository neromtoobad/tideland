// The house page: one home, its water line, and everyone who ever kept it afloat.
// Friends arrive here from a shared link and hold a button to save it. Releasing seals ONE atomic
// batch: the home's Lifetime Extension plus a signed tend record (the guestbook line).
import {
  HOME_MAX_SECONDS, HOME_STYLES, BLOCK_SECONDS, SIZE, homeMaxExpiry, keepAfloat, buildHome, tendsQuery, homesQuery, collect, blocksToText, toThing,
} from "../../shared/tideland.js"
import { spriteUrl } from "./render.js"
import { sfx } from "./sfx.js"

const HOLD_TICK_MS = 120
const HOLD_TICK_MINUTES = 8 // ~4 h for a 4-second hold
const MAX_BLOCKS = BigInt(HOME_MAX_SECONDS / BLOCK_SECONDS)

export function createHouse(deps) {
  const { state, headNow, pub, ensureWallet, toast, explorer, refresh, short, esc, same, view, onOpen } = deps
  const $ = (id) => document.getElementById(id)
  let cur = null // { key, home, tends, hold }

  // ---------- open / render ----------

  async function open(key, { push = true } = {}) {
    document.body.classList.add("housing")
    $("house").hidden = false
    $("house").innerHTML = `<div class="house-loading">Finding the house…</div>`
    if (push) history.replaceState(null, "", `?h=${key}${state.embed ? "&embed=1" : ""}`)
    onOpen?.()
    let home = state.things.get(key)
    try { home = toThing(await pub().getEntity(key)) } catch { /* sunk, or not indexed yet */ }
    cur = { key, home, tends: [], hold: null, saved: null }
    render()
    loadTends()
    // a visitor will want to save it: get their key and gas ready while they read
    if (home && !isMine()) ensureWallet({ quiet: true }).catch(() => {})
    if (home && view && !state.embed) view.focus(home.x, home.y)
  }

  function close() {
    cur = null
    $("house").hidden = true
    document.body.classList.remove("housing")
    history.replaceState(null, "", location.pathname)
  }

  async function loadTends() {
    if (!cur) return
    try {
      const tends = await collect(tendsQuery(pub(), cur.key))
      tends.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      cur.tends = tends
      render()
    } catch { /* keep what we have */ }
  }

  const isMine = () => cur?.home && same(cur.home.owner, state.wallet?.address)
  const expiry = () => cur.hold?.target ?? cur.home.expiresAt

  function render() {
    if (!cur) return
    const el = $("house"), h = cur.home, head = headNow()
    if (!h || h.expiresAt <= head) {
      el.innerHTML = `<button class="close" data-house="close" aria-label="Close">×</button>
        <div class="eyebrow">Lost to the tide</div><h2>${esc(h?.data?.name || "This house")} has sunk</h2>
        <p class="note">${h ? `It stayed afloat for <b>${blocksToText(h.expiresAt - h.createdAt)}</b>, kept up by ${new Set(cur.tends.map((t) => t.creator.toLowerCase())).size} people.` : "Nobody kept it afloat, or it never existed."}
        Its history is still on the explorer: <a href="${explorer}/entity/${cur.key}" target="_blank" rel="noopener">entity ${short(cur.key)}</a>.</p>
        ${guestbook()}
        <div class="row"><button class="primary" data-house="build">Build a house of your own</button></div>`
      return
    }
    const left = expiry() - head
    const helpers = new Set(cur.tends.map((t) => t.creator.toLowerCase()))
    const mine = isMine()
    const waterPct = water(left)
    el.innerHTML = `
      <button class="close" data-house="close" aria-label="Close">×</button>
      <div class="eyebrow">${mine ? "Your house" : "A house on the coast"} · ${h.x},${h.y}</div>
      <h2>${esc(h.data.name || "A house")}</h2>
      <div class="hstats">
        <div><b class="${left < 7200n ? "sink" : ""}" id="h-left">${blocksToText(left)}</b><span>until it sinks</span></div>
        <div><b>${blocksToText(head - h.createdAt)}</b><span>afloat so far</span></div>
        <div><b>${helpers.size}</b><span>${helpers.size === 1 ? "person has" : "people have"} kept it up</span></div>
      </div>
      <div class="diorama ${cur.hold ? "lifting" : ""}" id="h-diorama">
        <img src="${spriteUrl(h.style || "pine")}" alt="" style="transform: translateY(${(waterPct - 40) * 0.35}px)" />
        <div class="water" style="height:${waterPct}%"><i></i><i></i></div>
        <div class="gain" id="h-gain"></div>
      </div>
      ${mine ? `
        <p class="note">Only other people can keep your house afloat. It can hold at most 3 days, so it needs friends often. Share it:</p>
        ${shareRow(h, left)}
      ` : `
        <input id="h-note" maxlength="80" placeholder="Leave a note in the guestbook (optional, public)" />
        <button class="holdbtn" id="h-hold" data-house="hold"><span class="ring"></span><span class="lbl">Hold to keep it afloat</span></button>
        <p class="note small" id="h-status">${cur.saved ? `<span class="saved">You kept it afloat: <b>+${fmtMin(cur.saved.minutes)}</b>. <a href="${explorer}/tx/${cur.saved.tx}" target="_blank" rel="noopener">see the transaction</a></span>` : "Every second you hold buys it about an hour. Releasing seals it on Arkiv in one transaction."}</p>
        ${shareRow(h, left)}
      `}
      <p class="note small">Built by ${who(h.creator)}. Anyone can keep it up: it was created with <code>permissionlessExtension</code>, and every save is a signed record. <a href="${explorer}/entity/${h.key}" target="_blank" rel="noopener">entity</a></p>
      ${guestbook()}
      ${mine ? "" : `<div class="row"><button class="ghost" data-house="build">Build a house of your own</button></div>`}`
  }

  const who = (a) => `<a href="#" data-legacy="${a}">${short(a)}</a>${same(a, state.wallet?.address) ? " (you)" : ""}`

  function guestbook() {
    if (!cur.tends.length) return `<div class="gb"><h3>Kept afloat by</h3><p class="note">Nobody yet. Be the first name in the guestbook.</p></div>`
    const head = headNow()
    return `<div class="gb"><h3>Kept afloat by</h3><ol>${cur.tends.slice(0, 30).map((t) => `
      <li><span class="who">${who(t.creator)}</span><span class="plus">+${fmtMin(Number(t.attrs?.minutes ?? 0))}</span>
      <span class="when">${blocksToText(head - t.createdAt)} ago</span>${t.data.note ? `<q>${esc(t.data.note)}</q>` : ""}</li>`).join("")}</ol></div>`
  }

  function shareRow(h, left) {
    const url = `${location.origin}/h/${h.key}`
    const text = isMine()
      ? `My house on Tideland sinks in ${blocksToText(left)} unless someone keeps it afloat. Hold to save it:`
      : `I just kept "${h.data.name}" afloat on Tideland. It sinks in ${blocksToText(left)} without you:`
    return `<div class="row share"><a class="btn primary" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">Share on X</a>
      <button class="ghost" data-house="copy" data-url="${url}">Copy link</button></div>`
  }

  // water line: 12 h left sits mid-wall, 3 days is a dry beach, the last hour is up to the roof
  const water = (left) => Math.max(8, Math.min(86, 84 - Math.pow(Math.max(0, Number(left)) / Number(MAX_BLOCKS), 0.55) * 76))
  const fmtMin = (m) => (m < 60 ? `${m}m` : m < 1440 ? `${(m / 60).toFixed(m < 600 ? 1 : 0)}h` : `${(m / 1440).toFixed(1)}d`)

  // ---------- hold to save ----------

  async function holdStart() {
    if (!cur?.home || cur.hold || cur.sealing) return
    const head = headNow(), cap = homeMaxExpiry(head)
    cur.hold = { start: performance.now(), target: cur.home.expiresAt, cap, added: 0n, timer: null }
    $("h-hold")?.classList.add("holding")
    $("h-diorama")?.classList.add("lifting")
    const step = BigInt((HOLD_TICK_MINUTES * 60) / BLOCK_SECONDS)
    cur.hold.timer = setInterval(() => {
      const h = cur?.hold; if (!h) return
      const next = h.target + step > h.cap ? h.cap : h.target + step
      if (next === h.target) { status("It's as safe as it can be: a house holds 3 days at most."); return holdEnd() }
      h.added += next - h.target; h.target = next
      sfx.hammer(Math.min(18, Number(h.added / step)))
      paint()
    }, HOLD_TICK_MS)
  }

  function paint() {
    const h = cur.hold, head = headNow(), left = h.target - head
    const waterPct = water(left)
    const d = $("h-diorama"); if (!d) return
    d.querySelector(".water").style.height = `${waterPct}%`
    d.querySelector("img").style.transform = `translateY(${(waterPct - 40) * 0.35}px)`
    $("h-gain").textContent = `+${fmtMin(Math.round(Number(h.added) * BLOCK_SECONDS / 60))}`
    $("h-left").textContent = blocksToText(left)
    $("h-hold")?.style.setProperty("--p", Math.min(1, Number(h.added) / Number(MAX_BLOCKS)))
  }

  function status(t) { const s = $("h-status"); if (s) s.innerHTML = t }

  async function holdEnd() {
    const h = cur?.hold; if (!h) return
    clearInterval(h.timer)
    $("h-hold")?.classList.remove("holding")
    if (h.added <= 0n) { cur.hold = null; render(); return }
    cur.sealing = true
    const minutes = Number(h.added) * BLOCK_SECONDS / 60
    const note = $("h-note")?.value.trim() || ""
    status(`<span class="pulse">Sealing +${fmtMin(Math.round(minutes))} on Arkiv…</span>`)
    try {
      const wallet = await ensureWallet({ quiet: false })
      if (!wallet) throw new Error("no wallet")
      const r = await keepAfloat(wallet.client, pub(), { home: cur.home, addBlocks: h.added, note })
      if (r.full) throw new Error("it's already as safe as a house can be (3 days)")
      sfx.bell(); sfx.clutch()
      cur.home = { ...cur.home, expiresAt: r.target }
      cur.tends.unshift({ creator: wallet.address, createdAt: headNow(), attrs: { minutes: Math.round(r.minutes) }, data: { note }, key: r.createdEntities?.[0] })
      cur.hold = null; cur.sealing = false
      cur.saved = { minutes: Math.round(r.minutes), tx: r.txHash }
      render()
      setTimeout(loadTends, 3000)
      refresh().catch(() => {})
    } catch (e) {
      cur.hold = null; cur.sealing = false
      render()
      status(`That didn't seal: ${esc(String(e.shortMessage || e.message).slice(0, 120))}. Try again.`)
    }
  }

  // ---------- build your own ----------

  function openBuild() {
    document.body.classList.add("housing")
    $("house").hidden = false
    $("house").innerHTML = `
      <button class="close" data-house="close" aria-label="Close">×</button>
      <div class="eyebrow">A house of your own</div>
      <h2>Build on the shore</h2>
      <p class="note">Your house starts with 12 hours. After that, <b>only other people</b> can keep it afloat, and it never holds more than 3 days. Share it, and see who shows up.</p>
      <input id="b-name" maxlength="40" placeholder="Name it (e.g. Saltbreak Cottage). Public, so not your real name." />
      <div class="styles">${HOME_STYLES.map((s, i) => `<button class="style" data-style="${s}" aria-pressed="${i === 0}"><img src="${spriteUrl(s)}" alt="" /><span>${s}</span></button>`).join("")}</div>
      <div class="row"><button class="primary big" data-house="create">Build my house</button></div>
      <p class="note small" id="b-status">It goes on a free spot by the water. Building signs one transaction with a key kept in this browser.</p>`
  }

  function freeShoreCell() {
    const taken = (x, y) => { const c = state.cells.get(`${x}:${y}`); return c && (c.parcel || c.structure) }
    for (let tries = 0; tries < 400; tries++) {
      const x = Math.floor(Math.random() * SIZE), y = Math.floor(Math.random() * SIZE), d = x + y
      if (d < 30 || d > 52 || x > 28 || y > 28) continue // near the water, not on the harbour ring
      if (!taken(x, y)) return { x, y }
    }
    return { x: 14, y: 20 }
  }

  async function create() {
    const name = $("b-name")?.value.trim()
    if (!name) { $("b-name")?.focus(); return }
    const style = document.querySelector("[data-style][aria-pressed='true']")?.dataset.style || "pine"
    const s = $("b-status"); if (s) s.innerHTML = `<span class="pulse">Building on Tiramisu…</span>`
    try {
      const wallet = await ensureWallet({ quiet: false })
      if (!wallet) throw new Error("no wallet")
      const { x, y } = freeShoreCell()
      const r = await buildHome(wallet.client, { x, y, name, style })
      try { localStorage.setItem("tideland.myHome", r.entityKey) } catch {}
      sfx.start()
      await new Promise((res) => setTimeout(res, 1500))
      await refresh().catch(() => {})
      open(r.entityKey)
    } catch (e) { if (s) s.textContent = `That didn't work: ${String(e.shortMessage || e.message).slice(0, 140)}` }
  }

  // ---------- DOM wiring ----------

  document.addEventListener("click", (e) => {
    const st = e.target.closest("[data-style]")
    if (st) { for (const b of document.querySelectorAll("[data-style]")) b.setAttribute("aria-pressed", String(b === st)); return }
    const a = e.target.closest("[data-house]")?.dataset.house
    if (!a) return
    if (a === "close") close()
    else if (a === "build") openBuild()
    else if (a === "create") create()
    else if (a === "copy") { navigator.clipboard?.writeText(e.target.dataset.url); toast("Link copied. Send it to someone who'll keep it afloat.", 3500) }
  })
  const down = (e) => { if (e.target.closest("#h-hold")) { e.preventDefault(); holdStart() } }
  const up = () => { if (cur?.hold) holdEnd() }
  document.addEventListener("pointerdown", down)
  document.addEventListener("pointerup", up)
  document.addEventListener("pointercancel", up)
  document.addEventListener("keydown", (e) => { if (e.key === " " && cur && !cur.hold && document.activeElement?.id !== "h-note" && $("h-hold")) { e.preventDefault(); holdStart() } })
  document.addEventListener("keyup", (e) => { if (e.key === " " && cur?.hold) holdEnd() })
  setInterval(() => { if (cur && !cur.hold && !cur.sealing && $("h-left") && cur.home) $("h-left").textContent = blocksToText(expiry() - headNow()) }, 1000)

  /** Live: somebody (maybe across the world) just kept this house afloat while you watch. */
  function onExtended(key, expiresAt, from) {
    if (!cur || cur.key !== key || !cur.home || cur.hold) return
    if (expiresAt > cur.home.expiresAt) {
      cur.home = { ...cur.home, expiresAt }
      if (!same(from, state.wallet?.address)) { sfx.bell(); toast(`${from ? short(from) : "Someone"} just kept it afloat.`, 4000) }
      render(); setTimeout(loadTends, 3000)
    }
  }

  return {
    open, close, openBuild, onExtended, get key() { return cur?.key },
    myHome: () => { try { return localStorage.getItem("tideland.myHome") } catch { return null } },
    list: async () => (await collect(homesQuery(pub()))).filter((h) => h.expiresAt > headNow()),
  }
}
