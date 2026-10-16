#!/usr/bin/env node
// The founding guilds. Bots are ordinary players: each has its own wallet and signs its own writes,
// so the map shows real, distinct builders. Nothing here has powers a human player lacks.
//
//   node scripts/bots.mjs wallets        list bot addresses and balances
//   node scripts/bots.mjs fund [glm]     treasury tops up every bot below the amount
//   node scripts/bots.mjs seed           charters + first settlements (run once per season)
//   node scripts/bots.mjs tick           one round of village life (renew, neglect, tend, build, trade)
//   node scripts/bots.mjs loop [min]     tick forever (what the Railway worker runs)
//
// Keys: TREASURY_KEY and BOT_SEED env vars, else ~/.tideland/treasury.key and ~/.tideland/bots.seed.
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { keccak256, toHex, parseEther, formatEther } from "viem"
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts"
import {
  SIZE, MATERIALS, DAY_BLOCKS, publicClient, walletClient, collect, worldQuery, guildsQuery, layout, lifeLeft,
  claimAndBuild, renew, tend, inscribe, foundGuild, sell, build, placeCommons, COMMONS,
  buildHome, keepAfloat, homesQuery, HOME_STYLES, fish, sleep as goToBed, visit, lifeQuery, needsOf, DISHES,
  createPresence, movePresence, LEVELS, signersOf, earnedLevel, upgradeHome,
} from "../shared/tideland.js"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk"
import { str } from "@arkiv-network/sdk/attr"

const home = (n) => `${homedir()}/.tideland/${n}`
const secret = (env, file, make) => {
  if (process.env[env]) return process.env[env].trim()
  if (existsSync(home(file))) return readFileSync(home(file), "utf8").trim()
  if (!make) throw new Error(`missing ${env} (or ~/.tideland/${file})`)
  const v = make(); writeFileSync(home(file), v, { mode: 0o600 }); return v
}
if (!process.env.ARKIV_ACCESS_KEY && existsSync(home("access.key"))) process.env.ARKIV_ACCESS_KEY = readFileSync(home("access.key"), "utf8").trim()

const pub = publicClient()
const treasury = privateKeyToAccount(secret("TREASURY_KEY", "treasury.key"))
const seed = secret("BOT_SEED", "bots.seed", generatePrivateKey)
const botKey = (i) => keccak256(toHex(`${seed}:tideland-bot:${i}`))

// Three guilds, each with a founder and villagers. Colours map to the villager sprites in the client.
export const GUILDS = [
  { name: "Tidewrights", color: "#1F6E68", motto: "Pine today, pine again next week.", home: { x: 22, y: 6 }, mats: ["pine", "pine", "driftwood"] },
  { name: "Granite Hands", color: "#B4552E", motto: "Build once, build heavy.", home: { x: 12, y: 14 }, mats: ["stone", "pine", "stone"] },
  { name: "Lamplighters", color: "#96762B", motto: "No light goes out on our watch.", home: { x: 6, y: 25 }, mats: ["lighthouse", "driftwood", "pine"] },
]
const BOTS = GUILDS.flatMap((g, gi) => [0, 1, 2].map((j) => ({ guild: gi, role: j === 0 ? "founder" : "villager", i: gi * 3 + j })))
for (const b of BOTS) { b.account = privateKeyToAccount(botKey(b.i)); b.wallet = walletClient(b.account) }
// The Harbour Trust places the coast's commons and never maintains them. Upkeep is the players' job.
const TRUST = { i: 9, role: "trust", account: privateKeyToAccount(botKey(9)) }
TRUST.wallet = walletClient(TRUST.account)
const HARBOUR = { buoy: { want: 14, ring: [31, 30] }, jetty: { want: 6, ring: [30, 31] }, seawall: { want: 8, ring: [29, 28] } }
const HARBOUR_NAMES = { buoy: ["North Bell", "Gull Bell", "Fog Bell", "Kelp Bell", "Shoal Bell", "Sandbar Bell", "Low Bell", "Mist Bell", "Reef Bell", "Wreck Bell", "Tern Bell", "Swell Bell"],
  jetty: ["Fish Quay", "Crab Steps", "Netting Pier", "Ferry Stage", "Oyster Jetty", "Lobster Landing"], seawall: ["Breakwater", "Storm Wall", "Groyne Row", "Spray Wall", "Tide Bank", "Shingle Wall", "Harbour Arm"] }

/** Cells on a coastal ring: x or y equal to `at` (the far edges face the sea). */
function ringCell(w, at) {
  for (let tries = 0; tries < 80; tries++) {
    const k = Math.floor(Math.random() * SIZE), flip = Math.random() < 0.5
    const x = flip ? at : k, y = flip ? k : at
    if (!w.cells.get(`${x}:${y}`)?.structure && !w.cells.get(`${x}:${y}`)?.parcel) return { x, y }
  }
  return null
}

async function harbour(w) {
  for (const [material, cfg] of Object.entries(HARBOUR)) {
    const live = [...w.cells.values()].filter((c) => c.structure?.material === material).length
    for (let n = live; n < cfg.want; n++) {
      const cell = ringCell(w, cfg.ring[Math.floor(Math.random() * cfg.ring.length)]); if (!cell) break
      w.cells.set(`${cell.x}:${cell.y}`, { structure: { material } })
      await safely(`trust places ${material} @${cell.x},${cell.y}`, () => placeCommons(TRUST.wallet, { ...cell, material, name: pick(HARBOUR_NAMES[material]), wear: Math.random() * 0.85 }))
    }
  }
}

const PLACES = ["Saltbreak", "Kelp Hollow", "Gull's Rest", "Brinewatch", "Driftmere", "Oyster Row", "Shell Steps", "Low Tide Inn",
  "Netmender's", "Cobble End", "Spray Point", "Heron Yard", "Ropewalk", "Mussel Bank", "Lantern Lane", "Foam Gate", "Sandpiper",
  "Old Jetty", "Tarpaulin", "Weatherboard", "Cormorant", "Sea Pink", "Dune Cross", "Wrack Line"]
const LINES = ["We built this before the storm.", "Mind the tide, it does not mind you.", "Two winters on this sand.",
  "Whoever finds this: tend the light.", "The pine was cheap. The view was not.", "Gone fishing. Back if the house is.",
  "Here stood a camp. Then it didn't.", "Rent is paid in attention."]
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const HOME_NAMES = ["Kelp Cottage", "Gull's Rest", "Saltbox", "Netmender's House", "Low Tide Lodge", "Oyster Shack", "Brine Hall", "Sandpiper House", "Driftwood Den"]
const ISLANDERS = ["Ada", "Tunde", "Mira", "Kofi", "Lena", "Ife", "Bram", "Nneka", "Oto"]
const LOOK_OF_GUILD = ["carpenter", "mason", "lamplighter"]
const NOTES = ["Brought you something warm.", "Saw the water rising, couldn't leave you.", "Neighbours look after neighbours.",
  "Back from the nets, thought of you.", "The Lamplighters saw your light going out.", "One more day, friend.", "Just saying hi.", "", ""]

/** Every villager is an islander with needs. They look after themselves, and after each other. */
async function village() {
  const h = await head()
  const homes = (await collect(homesQuery(pub))).filter((x) => x.expiresAt > h)
  const w = await world()
  const byCreator = (a) => homes.find((x) => x.creator.toLowerCase() === a.toLowerCase())
  for (const b of BOTS) {
    const mine = byCreator(b.account.address)
    const look = LOOK_OF_GUILD[b.guild], islander = ISLANDERS[b.i % ISLANDERS.length]
    if (!mine) {
      const cell = freeCellNear(w, GUILDS[b.guild].home, 6); if (!cell) continue
      w.cells.set(`${cell.x}:${cell.y}`, { parcel: true })
      await safely(`${islander} moves in`, () => buildHome(b.wallet, { ...cell, name: HOME_NAMES[b.i % HOME_NAMES.length], style: pick(HOME_STYLES), islander, look }))
    } else if (!mine.look) {
      // homes from before islanders existed: patch in who lives there (homes are not readonly)
      await safely(`${islander} settles into ${mine.data.name}`, () => b.wallet.patchEntity({
        entityKey: mine.key, set: { look: str(look) }, payload: jsonToPayload({ ...mine.data, islander }), contentType: "application/json",
      }))
    }
  }
  const botAddrs = new Set(BOTS.map((b) => b.account.address.toLowerCase()))
  const lifeOf = new Map(await Promise.all(homes.map(async (x) => [x.key, await collect(lifeQuery(pub, x.key))])))
  const lives = new Map(homes.map((x) => [x.key, needsOf(x, lifeOf.get(x.key), h)]))
  // honest levels: a villager's house claims exactly what its signatures have earned
  for (const b of BOTS) {
    const home = byCreator(b.account.address); if (!home) continue
    const earned = LEVELS[earnedLevel(signersOf(home, lifeOf.get(home.key)).size)].style
    if (home.style !== earned) await safely(`${home.data.islander} ${LEVELS.findIndex((l) => l.style === earned) > LEVELS.findIndex((l) => l.style === home.style) ? "upgrades to" : "settles at"} ${earned}`, () => upgradeHome(b.wallet, { home, style: earned }))
  }
  await Promise.all(BOTS.map(async (b) => {
    const home = byCreator(b.account.address), n = home && lives.get(home.key)
    if (n && n.food < 0.35 && Math.random() < 0.7) await safely(`${home.data.islander ?? "?"} goes fishing`, () => fish(b.wallet, { home, dish: pick(["grilled mackerel", "smoked herring", "fish stew"]) }))
    if (n && n.rest < 0.25 && Math.random() < 0.8) await safely(`${home.data.islander ?? "?"} goes to bed`, () => goToBed(b.wallet, { home }))
    // visit a lonely neighbour, often with food, sometimes shoring up their house
    const neighbours = homes.filter((x) => botAddrs.has(x.creator.toLowerCase()) && x.key !== home?.key)
    const lonely = neighbours.filter((x) => (lives.get(x.key)?.friends ?? 0) < 0.5)
    if (neighbours.length && Math.random() < 0.6) await call(b, pick(lonely.length ? lonely : neighbours), lives, h)
    // a player's islander in trouble: rare, so friends still matter most
    const strangers = homes.filter((x) => !botAddrs.has(x.creator.toLowerCase()) && (x.expiresAt - h < 3600n || lives.get(x.key)?.mood === "hungry"))
    if (strangers.length && Math.random() < 0.12) await call(b, pick(strangers), lives, h)
  }))
}
/** Villagers wander: each round they stroll somewhere near home or to a neighbour's door (25-minute presence). */
async function wander() {
  const h = await head()
  const all = await collect(worldQuery(pub))
  const homes = all.filter((x) => x.kind === "home" && x.expiresAt > h)
  const presences = all.filter((x) => x.kind === "presence" && x.expiresAt > h)
  await Promise.all(BOTS.map(async (b) => {
    const home = homes.find((x) => x.creator.toLowerCase() === b.account.address.toLowerCase()); if (!home) return
    const goal = Math.random() < 0.35 ? pick(homes) : home
    const x = Math.max(0, Math.min(31, goal.x + 1 + Math.round((Math.random() - 0.5) * 3))), y = Math.max(0, Math.min(31, goal.y + 1 + Math.round((Math.random() - 0.5) * 3)))
    const mine = presences.find((p) => p.owner.toLowerCase() === b.account.address.toLowerCase())
    await safely(`${home.data.islander} strolls to ${x},${y}`, () => mine
      ? movePresence(b.wallet, { key: mine.key, x, y, seconds: 1500 })
      : createPresence(b.wallet, { home, x, y, seconds: 1500 }))
  }))
}

async function call(b, home, lives, h) {
  const n = lives.get(home.key)
  const dish = n && n.food < 0.5 ? pick(DISHES) : null
  const addBlocks = home.expiresAt - h < 43200n ? BigInt(Math.round((2 + Math.random() * 4) * 1800)) : 0n
  await safely(`${GUILDS[b.guild].name} visits ${home.data.islander ?? home.data.name}${dish ? ` with ${dish}` : ""}${addBlocks ? " and shores up the house" : ""}`,
    () => visit(b.wallet, pub, { home, note: pick(NOTES), dish, addBlocks }))
}

async function head() { return (await pub.getBlockTiming()).currentBlock }
async function world() {
  const things = await collect(worldQuery(pub))
  const h = await head()
  const live = things.filter((t) => t.expiresAt > h)
  return { h, live, cells: layout(live), guilds: live.filter((t) => t.kind === "guild") }
}
const guildKeyOf = (w, gi) => w.guilds.find((g) => g.data.name === GUILDS[gi].name && g.creator.toLowerCase() === BOTS[gi * 3].account.address.toLowerCase())?.key

function freeCellNear(w, { x, y }, radius = 5) {
  for (let tries = 0; tries < 60; tries++) {
    const cx = Math.max(0, Math.min(SIZE - 1, x + Math.round((Math.random() - 0.5) * 2 * radius)))
    const cy = Math.max(0, Math.min(SIZE - 1, y + Math.round((Math.random() - 0.5) * 2 * radius)))
    if (!w.cells.get(`${cx}:${cy}`)?.parcel) return { x: cx, y: cy }
  }
  return null
}

async function safely(label, fn) {
  try { const r = await fn(); log("ok  ", label, r?.txHash ?? ""); return r } catch (e) { log("FAIL", label, e.shortMessage || e.message); return null }
}

// ---------------------------------------------------------------------------------------------

async function wallets() {
  for (const b of [{ i: "T", role: "treasury", account: treasury }, ...BOTS, TRUST]) {
    const bal = await pub.getBalance({ address: b.account.address })
    console.log(String(b.i).padStart(2), (b.role).padEnd(9), b.guild !== undefined ? GUILDS[b.guild].name.padEnd(14) : "".padEnd(14), b.account.address, formatEther(bal))
  }
}

async function fund(amount = "0.05") {
  const want = parseEther(amount), tw = walletClient(treasury)
  for (const b of [...BOTS, TRUST]) {
    const bal = await pub.getBalance({ address: b.account.address })
    if (bal >= want / 2n) continue
    await safely(`fund ${b.account.address} ${amount} GLM`, async () => {
      const txHash = await tw.sendTransaction({ to: b.account.address, value: want - bal })
      await pub.waitForTransactionReceipt({ hash: txHash })
      return { txHash }
    })
  }
}

async function seedWorld() {
  let w = await world()
  for (const [gi, g] of GUILDS.entries()) {
    if (!guildKeyOf(w, gi)) await safely(`charter ${g.name}`, () => foundGuild(BOTS[gi * 3].wallet, g))
  }
  w = await world()
  const neglected = { x: 27, y: 22 } // the Driftwood Flats: camps nobody will tend
  await Promise.all(BOTS.map(async (b) => {
    const g = GUILDS[b.guild], gk = guildKeyOf(w, b.guild)
    for (let n = 0; n < 4; n++) {
      const cell = freeCellNear(w, g.home, 5); if (!cell) continue
      w.cells.set(`${cell.x}:${cell.y}`, { parcel: true }) // reserve locally
      const material = n === 0 && b.role === "founder" && b.guild === 1 ? "monument" : pick(g.mats)
      await safely(`${g.name} ${material} @${cell.x},${cell.y}`, () => claimAndBuild(b.wallet, { x: cell.x, y: cell.y, name: `${pick(PLACES)} ${material === "lighthouse" ? "Light" : ""}`.trim(), material, guild: gk }))
    }
    // two camps each on the Flats, never renewed: the tide will take them during the demo
    for (let n = 0; n < 2; n++) {
      const cell = freeCellNear(w, neglected, 3); if (!cell) continue
      w.cells.set(`${cell.x}:${cell.y}`, { parcel: true })
      await safely(`flats camp @${cell.x},${cell.y}`, () => claimAndBuild(b.wallet, { x: cell.x, y: cell.y, name: `${pick(PLACES)} Camp`, material: "driftwood" }))
    }
  }))
  await harbour(await world())
  await safely("inscription", () => inscribe(BOTS[0].wallet, { x: 16, y: 16, text: "Tideland, season one. Everything here is kept alive by someone.", span: "month" }))
}

/** One round of village life. Each bot acts on its own houses; lamplighters tend every light. */
async function tick() {
  const w = await world()
  await harbour(w)
  await safely("village", village)
  await safely("wander", wander)
  await Promise.all(BOTS.map(async (b) => {
    const me = b.account.address.toLowerCase(), g = GUILDS[b.guild]
    const mine = [...w.cells.values()].filter((c) => c.structure && c.structure.owner.toLowerCase() === me)
    for (const c of mine) {
      const s = c.structure, frac = lifeLeft(s, w.h)
      const onFlats = s.data.name?.endsWith("Camp")
      // Guild houses are tended when they fall below 40%; a quarter of the time a villager forgets.
      if (!onFlats && frac < 0.4 && Math.random() > 0.25 && s.material !== "monument") {
        await safely(`${g.name} renews ${s.data.name}`, () => renew(b.wallet, { structure: s, parcel: c.parcel?.owner.toLowerCase() === me ? c.parcel : null }))
      }
    }
    // Lamplighters keep every lighthouse on the coast lit, whoever owns it (permissionless extension).
    if (g.name === "Lamplighters") {
      for (const c of w.cells.values()) {
        const s = c.structure
        if (s?.material === "lighthouse" && s.expiresAt - w.h < DAY_BLOCKS && Math.random() > 0.3) await safely(`tend ${s.data.name}`, () => tend(b.wallet, s))
      }
    }
    // Sometimes build something new near home.
    if (Math.random() < 0.35) {
      const cell = freeCellNear(w, g.home, 7)
      if (cell) { w.cells.set(`${cell.x}:${cell.y}`, { parcel: true }); await safely(`${g.name} builds`, () => claimAndBuild(b.wallet, { x: cell.x, y: cell.y, name: pick(PLACES), material: pick(g.mats), guild: guildKeyOf(w, b.guild) })) }
    }
    // Now and then someone pitches a camp on the Driftwood Flats and never comes back: the tide's share.
    if (Math.random() < 0.15) {
      const cell = freeCellNear(w, { x: 27, y: 22 }, 3)
      if (cell) { w.cells.set(`${cell.x}:${cell.y}`, { parcel: true }); await safely("flats camp", () => claimAndBuild(b.wallet, { x: cell.x, y: cell.y, name: `${pick(PLACES)} Camp`, material: "driftwood" })) }
    }
    if (Math.random() < 0.12) {
      const c = pick([...w.cells.values()]); if (c) await safely("inscribe", () => inscribe(b.wallet, { x: c.x, y: c.y, text: pick(LINES), span: pick(["day", "week"]) }))
    }
    // Rarely, a founder hands a house to a villager: the builder's name stays, the holder changes.
    if (b.role === "founder" && Math.random() < 0.08) {
      const c = mine.find((x) => x.parcel?.owner.toLowerCase() === me && x.structure.material !== "monument")
      const heir = BOTS[b.i + 1 + Math.floor(Math.random() * 2)]
      if (c && heir) await safely(`${g.name} hands ${c.structure.data.name} to ${heir.account.address.slice(0, 8)}`, () => sell(b.wallet, { parcel: c.parcel, structure: c.structure, to: heir.account.address }))
    }
  }))
  // Founders renew their charters.
  for (const [gi] of GUILDS.entries()) {
    const gk = guildKeyOf(w, gi), ch = w.guilds.find((x) => x.key === gk)
    if (ch && lifeLeft(ch, w.h) < 0.5) await safely(`renew charter ${GUILDS[gi].name}`, () => BOTS[gi * 3].wallet.extendEntity({ entityKey: ch.key, expires: ExpirationTime.fromDays(30) }))
  }
}

const [cmd = "wallets", arg] = process.argv.slice(2)
if (cmd === "wallets") await wallets()
else if (cmd === "fund") await fund(arg)
else if (cmd === "seed") { await fund(arg ?? "0.05"); await seedWorld() }
else if (cmd === "tick") await tick()
else if (cmd === "harbour") await harbour(await world())
else if (cmd === "village") await village()
else if (cmd === "wander") await wander()
else if (cmd === "loop") {
  const every = Number(arg ?? 20) * 60_000
  for (;;) { await safely("fund", () => fund()); await safely("tick", tick); await sleep(every) }
} else console.log("usage: bots.mjs wallets | fund [glm] | seed | tick | loop [minutes]")
process.exit(0)
