// The islander page: one home, the islander who lives there, and their needs. Every need is an Arkiv
// entity pointing at the home: meals (8 h), sleep (12 h), visits (24 h), and the home itself (3 days max).
// Owners fish and sleep; friends visit, cook, and keep the house afloat, all as atomic batches.
import {
  HOME_MAX_SECONDS, HOME_STYLES, BLOCK_SECONDS, SIZE, LOOKS, NEEDS, DISHES, homeMaxExpiry, buildHome, fish, sleep, visit,
  lifeQuery, needsOf, collect, blocksToText, toThing, lifetimeBlocks,
} from "../../shared/tideland.js"
import { spriteUrl } from "./render.js"
import { sfx } from "./sfx.js"

const HOLD_TICK_MS = 120
const HOLD_TICK_MINUTES = 8
const MAX_BLOCKS = lifetimeBlocks(HOME_MAX_SECONDS)
const MOOD_LINE = {
  happy: "Content. Fed, rested, and somebody stopped by.", hungry: "Hungry. Nothing to eat in the house.", sleepy: "Exhausted. Hasn't slept in a long while.",
  sad: "Lonely. Nobody has visited today.", sleeping: "Asleep. Shh.", eating: "Eating. Mouth full.", waving: "Waving. A friend just came by!",
}
const MOOD_BUBBLE = { hungry: "🍲", sleepy: "💤", sad: "💧", sleeping: "💤", eating: "😋", waving: "👋", happy: "☀️" }
export const poseSprite = (look, mood) => `${look || "carpenter"}${{ happy: "", hungry: "-hungry", sleepy: "-sleepy", sad: "-sad", sleeping: "-sleeping", eating: "-eating", waving: "-waving" }[mood] ?? ""}`

export function createHouse(deps) {
  const { state, headNow, pub, ensureWallet, toast, explorer, refresh, short, esc, same, view, onOpen } = deps
  const $ = (id) => document.getElementById(id)
  let cur = null // { key, home, life, hold, saved }

  // ---------- open / data ----------

  async function open(key, { push = true } = {}) {
    document.body.classList.add("housing")
    $("house").hidden = false
    $("house").innerHTML = `<div class="house-loading">Knocking on the door…</div>`
    if (push) history.replaceState(null, "", `?h=${key}${state.embed ? "&embed=1" : ""}`)
    onOpen?.()
    let home = state.things.get(key)
    try { home = toThing(await pub().getEntity(key)) } catch { /* sunk, or not indexed yet */ }
    cur = { key, home, life: [...state.things.values()].filter((t) => t.home === key), hold: null, saved: null }
    render()
    loadLife()
    if (home && !isMine()) ensureWallet({ quiet: true }).catch(() => {})
    if (home && view && !state.embed) view.focus(home.x, home.y)
  }

  function close() {
    cur = null
    $("house").hidden = true
    document.body.classList.remove("housing")
    history.replaceState(null, "", location.pathname)
  }

  async function loadLife() {
    if (!cur) return
    try { cur.life = await collect(lifeQuery(pub(), cur.key)); render() } catch { /* keep what we have */ }
  }
  let reloadT = null
  const reloadSoon = () => { clearTimeout(reloadT); reloadT = setTimeout(loadLife, 2500) }

  const isMine = () => cur?.home && same(cur.home.owner, state.wallet?.address)
  const name = (h) => h?.data?.islander || "The islander"

  // ---------- render ----------

  function render() {
    if (!cur) return
    const el = $("house"), h = cur.home, head = headNow()
    if (!h || h.expiresAt <= head) {
      const helpers = new Set(cur.life.filter((t) => t.kind !== "sleep" && !same(t.creator, h?.owner)).map((t) => t.creator.toLowerCase()))
      el.innerHTML = `<button class="close" data-house="close" aria-label="Close">×</button>
        <div class="eyebrow">Lost to the tide</div><h2>${esc(h?.data?.name || "This house")} has sunk</h2>
        <p class="note">${h ? `It stood for <b>${blocksToText(h.expiresAt - h.createdAt)}</b>. ${helpers.size} ${helpers.size === 1 ? "person" : "people"} came to help. ${esc(name(h))} has moved on.` : "Nobody kept it afloat, or it never existed."}
        <a href="${explorer}/entity/${cur.key}" target="_blank" rel="noopener">Its history is still on the explorer.</a></p>
        ${diary(h)}
        <div class="row"><button class="primary" data-house="build">Start a new life on the shore</button></div>`
      return
    }
    const needs = needsOf(h, cur.life, head)
    const left = (cur.hold?.target ?? h.expiresAt) - head
    const mine = isMine()
    const mood = cur.hold ? "waving" : needs.mood
    el.innerHTML = `
      <button class="close" data-house="close" aria-label="Close">×</button>
      <div class="eyebrow">${mine ? "Your islander" : "An islander"} · ${esc(h.data.name)} · ${h.x},${h.y}</div>
      <h2>${esc(name(h))}</h2>
      <p class="mood mood-${needs.mood}">${MOOD_LINE[needs.mood]}</p>
      <div class="diorama ${cur.hold ? "lifting" : ""}" id="h-diorama">
        <img class="home" src="${spriteUrl(h.style || "pine")}" alt="" style="transform: translateY(${(water(left) - 40) * 0.35}px)" />
        <img class="islander" id="h-islander" src="${spriteUrl(poseSprite(h.look, mood))}" alt="" />
        <span class="bubble">${MOOD_BUBBLE[mood] ?? ""}</span>
        <div class="water" style="height:${water(left)}%"><i></i><i></i></div>
        <div class="gain" id="h-gain"></div>
      </div>
      <div class="needs">
        ${bar("Food", needs.food, sourceOf("meal", needs, head))}
        ${bar("Rest", needs.rest, sourceOf("sleep", needs, head))}
        ${bar("Friends", needs.friends, sourceOf("visit", needs, head))}
        ${bar("Home", needs.home, `sinks in <b id="h-left">${blocksToText(left)}</b>`, true)}
      </div>
      ${mine ? ownerActions(needs) : visitorActions(needs)}
      ${shareRow(h, needs, left)}
      ${diary(h)}
      <p class="note small">Every need is an Arkiv entity pointing at this home: meals last 8 h, sleep 12 h, visits 24 h, and the house can hold 3 days at most. The cook of every meal and the author of every visit are their on-chain <code>$creator</code>. <a href="${explorer}/entity/${h.key}" target="_blank" rel="noopener">home entity</a></p>
      ${mine ? "" : `<div class="row"><button class="ghost" data-house="build">Start your own islander</button></div>`}`
  }

  function bar(label, f, source, isHome) {
    const low = f < (isHome ? 0.12 : 0.15)
    return `<div class="need ${low ? "low" : ""}"><div class="nl"><b>${label}</b><span>${source}</span></div><div class="life ${low ? "low" : ""}"><span style="width:${(f * 100).toFixed(1)}%"></span></div></div>`
  }

  function sourceOf(kind, needs, head) {
    const t = needs.alive.filter((x) => x.kind === kind && (kind !== "visit" || !same(x.creator, cur.home.owner))).sort((a, b) => (a.expiresAt < b.expiresAt ? 1 : -1))[0]
    if (!t) return kind === "meal" ? "nothing to eat" : kind === "sleep" ? "hasn't slept" : "no visits today"
    if (kind === "meal") return `${esc(t.data.dish || t.dish || "a meal")}, ${same(t.creator, cur.home.owner) ? "caught themself" : `cooked by ${who(t.creator)}`} · ${blocksToText(t.expiresAt - head)}`
    if (kind === "sleep") return `slept ${blocksToText(head - t.createdAt)} ago · ${blocksToText(t.expiresAt - head)}`
    const n = new Set(needs.alive.filter((x) => x.kind === "visit" && !same(x.creator, cur.home.owner)).map((x) => x.creator.toLowerCase())).size
    return `${n} ${n === 1 ? "friend" : "friends"} today · last ${blocksToText(head - t.createdAt)} ago`
  }

  const who = (a) => `<a href="#" data-legacy="${a}">${short(a)}</a>${same(a, state.wallet?.address) ? " (you)" : ""}`

  function ownerActions(needs) {
    const canFish = needs.food < 0.6, canSleep = needs.rest < 0.5
    return `<div class="acts">
      <button class="holdbtn small-hold" id="h-fish" ${canFish ? "" : "disabled"}><span class="ring"></span><span class="lbl">${canFish ? "Hold to go fishing" : "Not hungry yet"}</span></button>
      <button class="primary" data-house="sleep" ${canSleep ? "" : "disabled"}>${canSleep ? "Go to bed" : "Well rested"}</button>
    </div>
    <p class="note small" id="h-status">${cur.saved ? cur.saved : `You can feed and rest ${esc(name(cur.home))} yourself. Friends, food from others and keeping the house afloat only come from other people.`}</p>`
  }

  function visitorActions(needs) {
    const hungry = needs.food < 0.5
    return `<input id="h-note" maxlength="80" placeholder="Say something (optional, public)" />
      <label class="bring"><input type="checkbox" id="h-dish" ${hungry ? "checked" : ""}/> Bring <b id="h-dishname">${esc(cur.dish ||= DISHES[Math.floor(Math.random() * DISHES.length)])}</b>${hungry ? ` <span class="sink small">(${esc(name(cur.home))} is hungry)</span>` : ""}</label>
      <button class="holdbtn" id="h-hold"><span class="ring"></span><span class="lbl">Tap to visit · hold to keep the house afloat</span></button>
      <p class="note small" id="h-status">${cur.saved ? cur.saved : "One transaction: your visit, the meal you hand over, and any time you add to the house, together or not at all."}</p>`
  }

  function diary(h) {
    if (!h) return ""
    const day = (b) => Math.floor(Number(b - h.createdAt) * BLOCK_SECONDS / 86400) + 1
    const nm = esc(name(h))
    const lines = [{ at: h.createdAt, text: `Moved into ${esc(h.data.name)}.` }]
    for (const t of cur.life) {
      const by = same(t.creator, h.owner) ? null : short(t.creator)
      if (t.kind === "meal") lines.push({ at: t.createdAt, text: by ? `${by} brought ${esc(t.data.dish || "food")}.` : `Caught ${esc(t.data.dish || "a fish")}.` })
      else if (t.kind === "sleep") lines.push({ at: t.createdAt, text: "Slept." })
      else if (t.kind === "visit" && by) lines.push({ at: t.createdAt, text: t.data.note ? `${by} came by: “${esc(t.data.note)}”` : `${by} came by.` })
      else if (t.kind === "tend") lines.push({ at: t.createdAt, text: `${by ?? "Someone"} shored up the house (+${fmtMin(Number(t.attrs?.minutes ?? 0))}).` })
    }
    lines.sort((a, b) => (a.at < b.at ? 1 : -1))
    return `<div class="gb diary"><h3>${nm}'s diary</h3><ol>${lines.slice(0, 14).map((l) => `<li><span class="when">Day ${day(l.at)}</span><span>${l.text}</span></li>`).join("")}</ol></div>`
  }

  function shareRow(h, needs, left) {
    const url = `${location.origin}/h/${h.key}`
    const plea = { hungry: "is hungry", sleepy: "is exhausted", sad: "is lonely", happy: "is doing fine, for now", sleeping: "is asleep", eating: "is eating", waving: "is waving" }[needs.mood]
    const text = isMine()
      ? `${name(h)} ${plea}, and our house on Tideland sinks in ${blocksToText(left)}. Come visit:`
      : `I just visited ${name(h)} on Tideland. The house sinks in ${blocksToText(left)} without you:`
    return `<div class="row share"><a class="btn primary" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">Share on X</a>
      <button class="ghost" data-house="copy" data-url="${url}">Copy link</button></div>`
  }

  const fmtMin = (m) => (m < 60 ? `${m}m` : m < 1440 ? `${(m / 60).toFixed(m < 600 ? 1 : 0)}h` : `${(m / 1440).toFixed(1)}d`)
  const water = (left) => Math.max(8, Math.min(86, 84 - Math.pow(Math.max(0, Number(left)) / Number(MAX_BLOCKS), 0.55) * 76))
  const status = (t) => { const s = $("h-status"); if (s) s.innerHTML = t }

  // ---------- visiting: tap to visit, hold to also keep the house afloat ----------

  function holdStart() {
    if (!cur?.home || cur.hold || cur.sealing) return
    cur.hold = { target: cur.home.expiresAt, cap: homeMaxExpiry(headNow()), added: 0n, timer: null, t0: performance.now() }
    $("h-hold")?.classList.add("holding")
    if ($("h-islander")) $("h-islander").src = spriteUrl(poseSprite(cur.home.look, "waving"))
    const step = BigInt((HOLD_TICK_MINUTES * 60) / BLOCK_SECONDS)
    cur.hold.timer = setInterval(() => {
      const h = cur?.hold; if (!h || performance.now() - h.t0 < 250) return // a tap is just a visit
      const next = h.target + step > h.cap ? h.cap : h.target + step
      if (next === h.target) return
      h.added += next - h.target; h.target = next
      sfx.hammer(Math.min(18, Number(h.added / step)))
      paint()
    }, HOLD_TICK_MS)
  }

  function paint() {
    const h = cur.hold, left = h.target - headNow(), d = $("h-diorama"); if (!d) return
    d.classList.add("lifting")
    d.querySelector(".water").style.height = `${water(left)}%`
    d.querySelector("img.home").style.transform = `translateY(${(water(left) - 40) * 0.35}px)`
    $("h-gain").textContent = `+${fmtMin(Math.round(Number(h.added) * BLOCK_SECONDS / 60))}`
    if ($("h-left")) $("h-left").textContent = blocksToText(left)
    $("h-hold")?.style.setProperty("--p", Math.min(1, Number(h.added) / Number(MAX_BLOCKS)))
  }

  async function holdEnd() {
    const h = cur?.hold; if (!h) return
    clearInterval(h.timer)
    $("h-hold")?.classList.remove("holding")
    cur.sealing = true
    const note = $("h-note")?.value.trim() || ""
    const dish = $("h-dish")?.checked ? cur.dish : null
    status(`<span class="pulse">Knocking${dish ? `, handing over ${esc(dish)}` : ""}${h.added > 0n ? `, adding +${fmtMin(Math.round(Number(h.added) * BLOCK_SECONDS / 60))} to the house` : ""}… one transaction on Arkiv</span>`)
    try {
      const wallet = await ensureWallet({ quiet: false })
      if (!wallet) throw new Error("no wallet")
      const r = await visit(wallet.client, pub(), { home: cur.home, note, dish, addBlocks: h.added })
      sfx.bell(); if (h.added > 0n) sfx.clutch()
      if (r.target) cur.home = { ...cur.home, expiresAt: r.target }
      const me = wallet.address, now = headNow()
      cur.life.unshift({ kind: "visit", creator: me, createdAt: now, expiresAt: now + lifetimeBlocks(NEEDS.friends.seconds), data: { note }, home: cur.key })
      if (dish) cur.life.unshift({ kind: "meal", creator: me, owner: cur.home.owner, createdAt: now, expiresAt: now + lifetimeBlocks(NEEDS.food.seconds), data: { dish }, home: cur.key })
      if (r.minutes) cur.life.unshift({ kind: "tend", creator: me, createdAt: now, expiresAt: now + 1000n, attrs: { minutes: Math.round(r.minutes) }, data: { note }, home: cur.key })
      cur.saved = `<span class="saved">You visited${dish ? ` and brought ${esc(dish)}` : ""}${r.minutes ? ` and kept the house afloat <b>+${fmtMin(Math.round(r.minutes))}</b>` : ""}. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">one transaction</a></span>`
      cur.dish = DISHES[Math.floor(Math.random() * DISHES.length)]
      reloadSoon(); refresh().catch(() => {})
    } catch (e) {
      cur.saved = `That didn't go through: ${esc(String(e.shortMessage || e.message).slice(0, 120))}. Try again.`
    }
    cur.hold = null; cur.sealing = false
    render()
  }

  // ---------- owner: fishing and sleep ----------

  function fishStart() {
    if (!cur?.home || cur.fishing || cur.sealing) return
    const f = { t0: performance.now(), timer: null }
    cur.fishing = f
    f.timer = setInterval(() => {
      const p = Math.min(1, (performance.now() - f.t0) / 2200)
      $("h-fish")?.style.setProperty("--p", p)
      const l = $("h-fish")?.querySelector(".lbl"); if (l) l.textContent = p < 1 ? "Waiting for a bite…" : "Got one! Let go"
      if (p >= 1) clearInterval(f.timer)
    }, 60)
  }
  async function fishEnd() {
    const f = cur?.fishing; if (!f) return
    clearInterval(f.timer); cur.fishing = null
    if (performance.now() - f.t0 < 2200) {
      status("The fish got away. Hold until it bites.")
      $("h-fish")?.style.setProperty("--p", 0)
      const l = $("h-fish")?.querySelector(".lbl"); if (l) l.textContent = "Hold to go fishing"
      return
    }
    const dish = ["grilled mackerel", "smoked herring", "fish stew"][Math.floor(Math.random() * 3)]
    await act(`Cooking ${dish}`, (w) => fish(w.client, { home: cur.home, dish }), (r) => {
      const now = headNow()
      cur.life.unshift({ kind: "meal", creator: state.wallet.address, owner: state.wallet.address, createdAt: now, expiresAt: now + lifetimeBlocks(NEEDS.food.seconds), data: { dish }, home: cur.key })
      return `Caught and cooked ${esc(dish)}. Fed for 8 hours. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">tx</a>`
    })
  }
  async function goToBed() {
    await act("Going to bed", (w) => sleep(w.client, { home: cur.home }), (r) => {
      const now = headNow()
      cur.life.unshift({ kind: "sleep", creator: state.wallet.address, createdAt: now, expiresAt: now + lifetimeBlocks(NEEDS.rest.seconds), data: {}, home: cur.key })
      return `Goodnight. Rested for 12 hours. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">tx</a>`
    })
  }
  async function act(label, fn, after) {
    if (cur.sealing) return
    cur.sealing = true; status(`<span class="pulse">${label}… signing on Arkiv</span>`)
    try {
      const w = await ensureWallet({ quiet: false }); if (!w) throw new Error("no wallet")
      const r = await fn(w)
      sfx.bell()
      cur.saved = `<span class="saved">${after(r)}</span>`
      reloadSoon()
    } catch (e) { cur.saved = `That didn't go through: ${esc(String(e.shortMessage || e.message).slice(0, 120))}` }
    cur.sealing = false
    render()
  }

  // ---------- start a life ----------

  function openBuild() {
    document.body.classList.add("housing")
    $("house").hidden = false
    $("house").innerHTML = `
      <button class="close" data-house="close" aria-label="Close">×</button>
      <div class="eyebrow">A new life on the shore</div>
      <h2>Move in</h2>
      <p class="note">Your islander needs food (8 h), sleep (12 h), friends (24 h), and a house that can only hold 3 days. You can fish and sleep; <b>only other people</b> can visit, cook for them, or keep the house afloat.</p>
      <div class="keepers">${LOOKS.map((l, i) => `<button class="keeper" data-look="${l}" aria-pressed="${i === 0}"><img src="${spriteUrl(l + "-waving")}" alt="" /><b>${l[0].toUpperCase() + l.slice(1)}</b></button>`).join("")}</div>
      <input id="b-islander" maxlength="24" placeholder="Their name (e.g. Ada). Public, so not your real name." />
      <input id="b-name" maxlength="40" placeholder="The house (e.g. Saltbreak Cottage)" />
      <div class="styles">${HOME_STYLES.map((s, i) => `<button class="style" data-style="${s}" aria-pressed="${i === 0}"><img src="${spriteUrl(s)}" alt="" /><span>${s}</span></button>`).join("")}</div>
      <div class="row"><button class="primary big" data-house="create">Move in</button></div>
      <p class="note small" id="b-status">The house goes on a free spot by the water, with 12 hours to start. One transaction, signed by a key kept in this browser.</p>`
  }

  function freeShoreCell() {
    const taken = (x, y) => { const c = state.cells.get(`${x}:${y}`); return c && (c.parcel || c.structure) }
    for (let tries = 0; tries < 400; tries++) {
      const x = Math.floor(Math.random() * SIZE), y = Math.floor(Math.random() * SIZE), d = x + y
      if (d < 30 || d > 52 || x > 28 || y > 28) continue
      if (!taken(x, y)) return { x, y }
    }
    return { x: 14, y: 20 }
  }

  async function create() {
    const islander = $("b-islander")?.value.trim(), houseName = $("b-name")?.value.trim()
    if (!islander) return $("b-islander")?.focus()
    if (!houseName) return $("b-name")?.focus()
    const style = document.querySelector("[data-style][aria-pressed='true']")?.dataset.style || "pine"
    const look = document.querySelector("[data-look][aria-pressed='true']")?.dataset.look || "carpenter"
    const s = $("b-status"); if (s) s.innerHTML = `<span class="pulse">Moving in…</span>`
    try {
      const wallet = await ensureWallet({ quiet: false }); if (!wallet) throw new Error("no wallet")
      const { x, y } = freeShoreCell()
      const r = await buildHome(wallet.client, { x, y, name: houseName, style, islander, look })
      try { localStorage.setItem("tideland.myHome", r.entityKey) } catch {}
      sfx.start()
      await new Promise((res) => setTimeout(res, 1500))
      await refresh().catch(() => {})
      open(r.entityKey)
    } catch (e) { if (s) s.textContent = `That didn't work: ${String(e.shortMessage || e.message).slice(0, 140)}` }
  }

  // ---------- live ----------

  function onExtended(key, expiresAt, from) {
    if (!cur || cur.key !== key || !cur.home || cur.hold) return
    if (expiresAt > cur.home.expiresAt) {
      cur.home = { ...cur.home, expiresAt }
      if (!same(from, state.wallet?.address)) { sfx.bell(); toast(`${from ? short(from) : "Someone"} just shored up the house.`, 4000) }
      render(); reloadSoon()
    }
  }
  /** Any entity created anywhere: if an islander is open, re-read its life once things settle. */
  function onCreated() { if (cur && !cur.sealing) reloadSoon() }

  // ---------- DOM wiring ----------

  document.addEventListener("click", (e) => {
    const pick = (sel) => { const b = e.target.closest(sel); if (!b) return false; for (const x of document.querySelectorAll(sel)) x.setAttribute("aria-pressed", String(x === b)); return true }
    if (pick("[data-style]") || pick("[data-look]")) return
    const a = e.target.closest("[data-house]")?.dataset.house
    if (!a) return
    if (a === "close") close()
    else if (a === "build") openBuild()
    else if (a === "create") create()
    else if (a === "sleep") goToBed()
    else if (a === "copy") { navigator.clipboard?.writeText(e.target.dataset.url); toast("Link copied. Send it to someone who'll come by.", 3500) }
  })
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#h-hold")) { e.preventDefault(); holdStart() }
    else if (e.target.closest("#h-fish:not([disabled])")) { e.preventDefault(); fishStart() }
  })
  const up = () => { if (cur?.hold) holdEnd(); if (cur?.fishing) fishEnd() }
  document.addEventListener("pointerup", up)
  document.addEventListener("pointercancel", up)
  setInterval(() => { if (cur && !cur.hold && !cur.sealing && $("h-left") && cur.home) $("h-left").textContent = blocksToText(cur.home.expiresAt - headNow()) }, 1000)

  return {
    open, close, openBuild, onExtended, onCreated, get key() { return cur?.key },
    myHome: () => { try { return localStorage.getItem("tideland.myHome") } catch { return null } },
  }
}
