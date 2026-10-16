// The islander app. One islander per player; their needs are Arkiv entities pointing at their home:
// meals (8 h), sleep (12 h), visits (24 h), and the home itself (3 days at most). Owners fish and sleep;
// only other people can visit, cook for them, or keep the house afloat. Every action is one transaction.
import {
  HOME_MAX_SECONDS, HOME_STYLES, BLOCK_SECONDS, SIZE, LOOKS, NEEDS, DISHES, homeMaxExpiry, buildHome, fish, sleep, visit,
  lifeQuery, needsOf, collect, blocksToText, toThing, lifetimeBlocks,
} from "../../shared/tideland.js"
import { spriteUrl } from "./render.js"
import { sfx } from "./sfx.js"

const HOLD_TICK_MS = 120
const HOLD_TICK_MINUTES = 8
const MAX_BLOCKS = lifetimeBlocks(HOME_MAX_SECONDS)
const ago = (b) => (b <= 30n ? "just now" : `${blocksToText(b)} ago`)
const MOOD_SELF = {
  happy: "is doing well.", hungry: "is hungry.", sleepy: "is exhausted.", sad: "is lonely.", sleeping: "is asleep.", eating: "is eating.", waving: "is waving at a visitor!",
}
const MOOD_BUBBLE = { hungry: "🍲", sleepy: "💤", sad: "💧", sleeping: "💤", eating: "😋", waving: "👋", happy: "☀️" }
export const poseSprite = (look, mood) => `${look || "carpenter"}${{ happy: "", hungry: "-hungry", sleepy: "-sleepy", sad: "-sad", sleeping: "-sleeping", eating: "-eating", waving: "-waving" }[mood] ?? ""}`

export function createHouse(deps) {
  const { state, headNow, pub, ensureWallet, toast, explorer, refresh, short, esc, same, view, onOpen } = deps
  const $ = (id) => document.getElementById(id)
  let cur = null // { key, home, life, hold, saved, dish }

  const myHome = () => { try { return localStorage.getItem("tideland.myHome") } catch { return null } }
  const show = () => { $("house").hidden = false; document.body.classList.add("housing") }
  const name = (h) => h?.data?.islander || h?.data?.name || "The islander"

  // ---------- routing ----------

  /** Home screen: your islander if you have one, otherwise the landing page. */
  function home() {
    const k = myHome()
    if (k && (state.things.get(k)?.expiresAt ?? 1n) > headNow()) return open(k)
    landing()
  }

  async function open(key, { push = true, panel = false } = {}) {
    show()
    cur = null
    $("house").innerHTML = `<div class="house-loading">Knocking on the door…</div>`
    if (push) history.replaceState(null, "", `?h=${key}${state.embed ? "&embed=1" : ""}`)
    onOpen?.({ panel })
    let h = state.things.get(key)
    try { h = toThing(await pub().getEntity(key)) } catch { /* sunk, or not indexed yet */ }
    cur = { key, home: h, life: [...state.things.values()].filter((t) => t.home === key), hold: null, saved: null }
    render()
    loadLife()
    if (h && !isMine()) ensureWallet({ quiet: true }).catch(() => {})
    if (h && view && !state.embed) view.focus(h.x, h.y)
  }

  async function loadLife() {
    if (!cur?.key) return
    try { cur.life = await collect(lifeQuery(pub(), cur.key)); render() } catch { /* keep what we have */ }
  }
  let reloadT = null
  const reloadSoon = () => { clearTimeout(reloadT); reloadT = setTimeout(loadLife, 2500) }
  const isMine = () => cur?.home && same(cur.home.owner, state.wallet?.address)

  // ---------- landing ----------

  function landing() {
    cur = null; show()
    history.replaceState(null, "", location.pathname)
    $("house").innerHTML = `<div class="landing">
      <div class="trio">${LOOKS.map((l) => `<img src="${spriteUrl(l + "-waving")}" alt="" />`).join("")}</div>
      <h2>Keep an islander alive</h2>
      <p class="lead">A little islander moves into a house by the sea. They need things, and you can't give them everything yourself.</p>
      <ul class="howto">
        <li><span>🎣</span><div>You feed them by going fishing.</div></li>
        <li><span>😴</span><div>You put them to bed.</div></li>
        <li><span>🤝</span><div>They need friends, and only <b>other people</b> can visit.</div></li>
        <li><span>🌊</span><div>Their house sinks within 3 days unless visitors shore it up.</div></li>
      </ul>
      <button class="primary cta-big" data-house="build">Move in</button>
      ${neighbours("Or visit someone who needs help now")}
      <details class="more"><summary>What's actually happening?</summary><p>Every meal, night's sleep, visit and house is an entity on <a href="https://arkiv.network" target="_blank" rel="noopener">Arkiv</a>, the Web3 database, and each one expires on its own: a meal after 8 hours, sleep after 12, a visit after 24. Nobody runs a server that decides; when the entity is gone, the need is back. Your browser holds a small test key and signs each action itself.</p></details>
    </div>`
  }

  function neighbours(title) {
    const head = headNow(), mine = myHome()
    const homes = [...state.things.values()].filter((t) => t.kind === "home" && t.expiresAt > head && t.key !== mine && t.key !== cur?.key)
    const score = (h) => { const m = state.moods?.get(h.key); return (m === "hungry" || m === "sad" || m === "sleepy" ? 0 : 1) * 1e9 + Number(h.expiresAt - head) }
    homes.sort((a, b) => score(a) - score(b))
    if (!homes.length) return ""
    const word = (h) => {
      const m = state.moods?.get(h.key)
      if (h.expiresAt - head < 21600n) return `house sinks in ${blocksToText(h.expiresAt - head)}`
      return { hungry: "is hungry", sad: "is lonely", sleepy: "is exhausted", sleeping: "is asleep", eating: "is eating", waving: "has a visitor" }[m] ?? "is doing fine"
    }
    return `<div class="neigh"><h3>${title}</h3><ol>${homes.slice(0, 5).map((h) => `
      <li><img src="${spriteUrl(poseSprite(h.look, state.moods?.get(h.key) || "happy"))}" alt="" />
      <div><b>${esc(name(h))}</b><span class="${/fine|asleep|eating|visitor/.test(word(h)) ? "ok" : ""}">${esc(word(h))}</span></div>
      <button class="ghost" data-visit="${h.key}">Visit</button></li>`).join("")}</ol></div>`
  }

  // ---------- an islander ----------

  function render() {
    if (!cur) return
    const el = $("house"), h = cur.home, head = headNow()
    if (!h || h.expiresAt <= head) {
      el.innerHTML = `<div class="eyebrow">Lost to the tide</div><h2>${esc(name(h) || "This islander")}'s house has sunk</h2>
        <p class="note">${h ? `It stood for <b>${blocksToText(h.expiresAt - h.createdAt)}</b>. Nobody shored it up in time, so ${esc(name(h))} has moved on.` : "This house doesn't exist, or it sank before anyone came."}</p>
        ${diary(h)}
        <button class="primary cta-big" data-house="build">${myHome() === cur.key ? "Start again" : "Move in an islander of your own"}</button>
        ${neighbours("Others who need help")}`
      return
    }
    const n = needsOf(h, cur.life, head)
    const left = (cur.hold?.target ?? h.expiresAt) - head
    const mine = isMine()
    const mood = cur.hold ? "waving" : n.mood
    const nm = esc(name(h))
    el.innerHTML = `${closeBtn()}
      <div class="eyebrow">${mine ? "Your islander" : "You're visiting"}</div>
      <h2>${nm}</h2>
      <p class="mood mood-${n.mood}">${nm} ${MOOD_SELF[n.mood]}</p>
      <div class="diorama ${cur.hold ? "lifting" : ""}" id="h-diorama">
        <img class="home" src="${spriteUrl(h.style || "pine")}" alt="" style="transform: translateY(${(water(left) - 40) * 0.35}px)" />
        <img class="islander pose-${mood}" id="h-islander" src="${spriteUrl(poseSprite(h.look, mood))}" alt="" />
        <span class="bubble">${MOOD_BUBBLE[mood] ?? ""}</span>
        <div class="water" style="height:${water(left)}%"><i></i><i></i></div>
        <div class="gain" id="h-gain"></div>
      </div>
      <div class="needs">
        ${bar("🍲 Food", n.food, plain("meal", n, head))}
        ${bar("😴 Sleep", n.rest, plain("sleep", n, head))}
        ${bar("🤝 Friends", n.friends, plain("visit", n, head))}
        ${bar("🏠 House", n.home, `sinks in <b id="h-left">${blocksToText(left)}</b>`, true)}
      </div>
      ${mine ? ownerPart(n, h) : visitorPart(n, h)}
      ${diary(h)}
      ${mine ? neighbours("Neighbours who need help") : ""}
      <details class="more"><summary>How this works on Arkiv</summary><p>Each bar is an Arkiv entity pointing at this house, and it expires by itself: a meal after 8 hours, sleep after 12, a visit after 24; the house can hold 3 days at most and anyone can extend it. Whoever cooked a meal or visited is that entity's on-chain author. <a href="${explorer}/entity/${h.key}" target="_blank" rel="noopener">See the house entity</a>.</p></details>`
  }

  const closeBtn = () => (document.body.classList.contains("play") ? `<button class="close" data-house="close" aria-label="Back to the island">×</button>` : "")
  function close() {
    cur = null; $("house").hidden = true; document.body.classList.remove("housing")
    history.replaceState(null, "", location.pathname)
  }

  function bar(label, f, text, isHome) {
    const low = f < (isHome ? 0.12 : 0.15)
    return `<div class="need ${low ? "low" : ""}"><div class="nl"><b>${label}</b><span>${text}</span></div><div class="life ${low ? "low" : ""}"><span style="width:${(f * 100).toFixed(1)}%"></span></div></div>`
  }

  function plain(kind, n, head) {
    const live = n.alive.filter((x) => x.kind === kind && (kind !== "visit" || !same(x.creator, cur.home.owner))).sort((a, b) => (a.expiresAt < b.expiresAt ? 1 : -1))
    const t = live[0]
    if (kind === "meal") return t ? `full for ${blocksToText(t.expiresAt - head)}${same(t.creator, cur.home.owner) ? "" : ` · ${esc(t.data.dish || "food")} from ${who(t.creator)}`}` : "hungry"
    if (kind === "sleep") return t ? `rested for ${blocksToText(t.expiresAt - head)}` : "tired"
    const people = new Set(live.map((x) => x.creator.toLowerCase())).size
    return people ? `${people} ${people === 1 ? "friend" : "friends"} visited today` : "nobody visited today"
  }

  const who = (a) => `<a href="#" data-legacy="${a}">${same(a, state.wallet?.address) ? "you" : short(a)}</a>`

  function ownerPart(n, h) {
    const canFish = n.food < 0.6, canSleep = n.rest < 0.5
    const url = `${location.origin}/h/${h.key}`
    const lonely = n.friends < 0.34, sinking = n.home < 0.25
    const text = `${name(h)} on Tideland ${lonely ? "is lonely" : "says hi"}${sinking ? " and the house is flooding" : ""}. Come visit:`
    return `<div class="acts2">
        <button class="holdbtn" id="h-fish" ${canFish ? "" : "disabled"}><span class="ring"></span><span class="lbl">${canFish ? "🎣 Hold to fish" : "🍲 Not hungry"}</span></button>
        <button class="primary" data-house="sleep" ${canSleep ? "" : "disabled"}>${canSleep ? "😴 Put to bed" : "😴 Well rested"}</button>
      </div>
      ${cur.saved ? `<p class="note small">${cur.saved}</p>` : ""}
      <div class="callout ${lonely || sinking ? "warn" : ""}">
        <b>${lonely ? `${esc(name(h))} needs friends` : sinking ? "The house needs shoring up" : "Keep the visits coming"}</b>
        <p>You can't visit your own islander. Send this link to someone; when they visit, ${esc(name(h))} gets a friend, maybe a meal, and more time for the house.</p>
        <div class="linkbox"><input readonly value="${url}" onclick="this.select()" /><button class="ghost" data-house="copy" data-url="${url}">Copy</button></div>
        <a class="btn primary" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">Share on X</a>
      </div>`
  }

  function visitorPart(n, h) {
    const nm = esc(name(h)), hungry = n.food < 0.5
    return `<label class="bring"><input type="checkbox" id="h-dish" ${hungry ? "checked" : ""}/> Bring ${esc(cur.dish ||= DISHES[Math.floor(Math.random() * DISHES.length)])}${hungry ? ` <span class="sink small">(${nm} is hungry)</span>` : ""}</label>
      <input id="h-note" maxlength="80" placeholder="Say something to ${nm} (optional)" />
      <button class="holdbtn" id="h-hold"><span class="ring"></span><span class="lbl">Visit ${nm}</span></button>
      <p class="note small" id="h-status">${cur.saved ? cur.saved : `Tap to visit. <b>Hold</b> to also shore up the house; the longer you hold, the more time it gets.`}</p>
      ${cur.saved && !myHome() ? `<div class="callout"><b>Want one of your own?</b><p>Move in an islander and send your link to the people who visit you back.</p><button class="primary" data-house="build">Move in</button></div>` : ""}`
  }

  function diary(h) {
    if (!h) return ""
    const day = (b) => Math.floor(Number(b - h.createdAt) * BLOCK_SECONDS / 86400) + 1
    const lines = [{ at: h.createdAt, text: `Moved in.` }]
    for (const t of cur.life) {
      const by = same(t.creator, h.owner) ? null : (same(t.creator, state.wallet?.address) ? "You" : short(t.creator))
      if (t.kind === "meal") lines.push({ at: t.createdAt, text: by ? `${by} brought ${esc(t.data.dish || "food")}.` : `Caught ${esc(t.data.dish || "a fish")}.` })
      else if (t.kind === "sleep") lines.push({ at: t.createdAt, text: "Slept." })
      else if (t.kind === "visit" && by) lines.push({ at: t.createdAt, text: t.data.note ? `${by} visited: “${esc(t.data.note)}”` : `${by} visited.` })
      else if (t.kind === "tend") lines.push({ at: t.createdAt, text: `${by ?? "Someone"} shored up the house (+${fmtMin(Number(t.attrs?.minutes ?? 0))}).` })
    }
    lines.sort((a, b) => (a.at < b.at ? 1 : -1))
    return `<details class="gb diary" ${lines.length > 1 ? "open" : ""}><summary><h3 style="display:inline">${esc(name(h))}'s diary</h3></summary><ol>${lines.slice(0, 12).map((l) => `<li><span class="when">Day ${day(l.at)}</span><span>${l.text}</span></li>`).join("")}</ol></details>`
  }

  const fmtMin = (m) => (m < 60 ? `${m}m` : m < 1440 ? `${(m / 60).toFixed(m < 600 ? 1 : 0)}h` : `${(m / 1440).toFixed(1)}d`)
  const water = (left) => Math.max(8, Math.min(86, 84 - Math.pow(Math.max(0, Number(left)) / Number(MAX_BLOCKS), 0.55) * 76))
  const status = (t) => { const s = $("h-status"); if (s) s.innerHTML = t }

  // ---------- visiting: tap to visit, hold to also shore up the house ----------

  function holdStart() {
    if (!cur?.home || cur.hold || cur.sealing) return
    cur.hold = { target: cur.home.expiresAt, cap: homeMaxExpiry(headNow()), added: 0n, timer: null, t0: performance.now() }
    $("h-hold")?.classList.add("holding")
    if ($("h-islander")) $("h-islander").src = spriteUrl(poseSprite(cur.home.look, "waving"))
    const step = BigInt((HOLD_TICK_MINUTES * 60) / BLOCK_SECONDS)
    cur.hold.timer = setInterval(() => {
      const h = cur?.hold; if (!h || performance.now() - h.t0 < 300) return // a tap is just a visit
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
    status(`<span class="pulse">Visiting${dish ? ` with ${esc(dish)}` : ""}${h.added > 0n ? ` and shoring up the house +${fmtMin(Math.round(Number(h.added) * BLOCK_SECONDS / 60))}` : ""}…</span>`)
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
      cur.saved = `<span class="saved">${esc(name(cur.home))} is glad you came${dish ? ` (and ate the ${esc(dish)})` : ""}${r.minutes ? `. You shored up the house <b>+${fmtMin(Math.round(r.minutes))}</b>` : ""}. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">receipt</a></span>`
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
      const l = $("h-fish")?.querySelector(".lbl"); if (l) l.textContent = p < 1 ? "🎣 Waiting for a bite…" : "🐟 Got one! Let go"
      if (p >= 1) clearInterval(f.timer)
    }, 60)
  }
  async function fishEnd() {
    const f = cur?.fishing; if (!f) return
    clearInterval(f.timer); cur.fishing = null
    if (performance.now() - f.t0 < 2200) {
      $("h-fish")?.style.setProperty("--p", 0)
      const l = $("h-fish")?.querySelector(".lbl"); if (l) l.textContent = "🎣 It got away. Hold longer"
      return
    }
    const dish = ["grilled mackerel", "smoked herring", "fish stew"][Math.floor(Math.random() * 3)]
    await act((w) => fish(w.client, { home: cur.home, dish }), (r) => {
      const now = headNow()
      cur.life.unshift({ kind: "meal", creator: state.wallet.address, owner: state.wallet.address, createdAt: now, expiresAt: now + lifetimeBlocks(NEEDS.food.seconds), data: { dish }, home: cur.key })
      return `Caught ${esc(dish)}. Full for 8 hours. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">receipt</a>`
    })
  }
  async function goToBed() {
    await act((w) => sleep(w.client, { home: cur.home }), (r) => {
      const now = headNow()
      cur.life.unshift({ kind: "sleep", creator: state.wallet.address, createdAt: now, expiresAt: now + lifetimeBlocks(NEEDS.rest.seconds), data: {}, home: cur.key })
      return `Goodnight. Rested for 12 hours. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">receipt</a>`
    })
  }
  async function act(fn, after) {
    if (cur.sealing) return
    cur.sealing = true
    const btns = document.querySelectorAll("#h-fish, [data-house='sleep']"); btns.forEach((b) => { b.disabled = true })
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

  // ---------- moving in: pick someone, name them ----------

  function openBuild() {
    cur = null; show()
    $("house").innerHTML = `
      <div class="eyebrow">Move in</div>
      <h2>Who's moving in?</h2>
      <div class="keepers">${LOOKS.map((l, i) => `<button class="keeper" data-look="${l}" aria-pressed="${i === 0}"><img src="${spriteUrl(l + "-waving")}" alt="" /><b>${l[0].toUpperCase() + l.slice(1)}</b></button>`).join("")}</div>
      <input id="b-islander" maxlength="24" placeholder="Give them a name (e.g. Wren)" />
      <button class="primary cta-big" data-house="create">Move in</button>
      <p class="note small" id="b-status">They get a house by the sea with 12 hours before the tide reaches it. Pick a made-up name; it's public.</p>
      <button class="textlink" data-nav="home">Back</button>`
    setTimeout(() => $("b-islander")?.focus(), 50)
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
    const islander = $("b-islander")?.value.trim()
    if (!islander) return $("b-islander")?.focus()
    const look = document.querySelector("[data-look][aria-pressed='true']")?.dataset.look || "carpenter"
    const style = HOME_STYLES[Math.floor(Math.random() * 2)] // pine or stone
    const s = $("b-status"); if (s) s.innerHTML = `<span class="pulse">Moving ${esc(islander)} in…</span>`
    try {
      const wallet = await ensureWallet({ quiet: false }); if (!wallet) throw new Error("no wallet")
      const { x, y } = freeShoreCell()
      const r = await buildHome(wallet.client, { x, y, name: `${islander}'s place`, style, islander, look })
      try { localStorage.setItem("tideland.myHome", r.entityKey) } catch {}
      sfx.start()
      await new Promise((res) => setTimeout(res, 1500))
      await refresh().catch(() => {})
      if (deps.onMovedIn) deps.onMovedIn(r.entityKey); else open(r.entityKey)
    } catch (e) { if (s) s.textContent = `That didn't work: ${String(e.shortMessage || e.message).slice(0, 140)}` }
  }

  // ---------- live ----------

  function onExtended(key, expiresAt, from) {
    if (!cur || cur.key !== key || !cur.home || cur.hold) return
    if (expiresAt > cur.home.expiresAt) {
      cur.home = { ...cur.home, expiresAt }
      if (!same(from, state.wallet?.address)) { sfx.bell(); toast(`${from ? short(from) : "Someone"} just shored up ${esc(name(cur.home))}'s house.`, 4000) }
      render(); reloadSoon()
    }
  }
  function onCreated() { if (cur && !cur.sealing) reloadSoon() }

  // ---------- DOM wiring ----------

  document.addEventListener("click", (e) => {
    const pick = (sel) => { const b = e.target.closest(sel); if (!b) return false; for (const x of document.querySelectorAll(sel)) x.setAttribute("aria-pressed", String(x === b)); return true }
    if (pick("[data-style]") || pick("[data-look]")) return
    const v = e.target.closest("[data-visit]"); if (v) return open(v.dataset.visit)
    const a = e.target.closest("[data-house]")?.dataset.house
    if (!a) return
    if (a === "close") close()
    else if (a === "build") openBuild()
    else if (a === "create") create()
    else if (a === "sleep") goToBed()
    else if (a === "copy") { navigator.clipboard?.writeText(e.target.dataset.url); toast("Link copied. Send it to someone who'll visit.", 3500) }
  })
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && document.activeElement?.id === "b-islander") create() })
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#h-hold")) { e.preventDefault(); holdStart() }
    else if (e.target.closest("#h-fish:not([disabled])")) { e.preventDefault(); fishStart() }
  })
  const up = () => { if (cur?.hold) holdEnd(); if (cur?.fishing) fishEnd() }
  document.addEventListener("pointerup", up)
  document.addEventListener("pointercancel", up)
  setInterval(() => { if (cur && !cur.hold && !cur.sealing && $("h-left") && cur.home) $("h-left").textContent = blocksToText(cur.home.expiresAt - headNow()) }, 1000)

  return { open, close, home, landing, openBuild, onExtended, onCreated, rerender: () => (cur ? render() : null), get key() { return cur?.key }, myHome }
}
