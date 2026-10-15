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
  claimAndBuild, renew, tend, inscribe, foundGuild, sell, build,
} from "../shared/tideland.js"
import { ExpirationTime } from "@arkiv-network/sdk"

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

const PLACES = ["Saltbreak", "Kelp Hollow", "Gull's Rest", "Brinewatch", "Driftmere", "Oyster Row", "Shell Steps", "Low Tide Inn",
  "Netmender's", "Cobble End", "Spray Point", "Heron Yard", "Ropewalk", "Mussel Bank", "Lantern Lane", "Foam Gate", "Sandpiper",
  "Old Jetty", "Tarpaulin", "Weatherboard", "Cormorant", "Sea Pink", "Dune Cross", "Wrack Line"]
const LINES = ["We built this before the storm.", "Mind the tide, it does not mind you.", "Two winters on this sand.",
  "Whoever finds this: tend the light.", "The pine was cheap. The view was not.", "Gone fishing. Back if the house is.",
  "Here stood a camp. Then it didn't.", "Rent is paid in attention."]
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

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
  for (const b of [{ i: "T", role: "treasury", account: treasury }, ...BOTS]) {
    const bal = await pub.getBalance({ address: b.account.address })
    console.log(String(b.i).padStart(2), (b.role).padEnd(9), b.guild !== undefined ? GUILDS[b.guild].name.padEnd(14) : "".padEnd(14), b.account.address, formatEther(bal))
  }
}

async function fund(amount = "0.05") {
  const want = parseEther(amount), tw = walletClient(treasury)
  for (const b of BOTS) {
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
  await safely("inscription", () => inscribe(BOTS[0].wallet, { x: 16, y: 16, text: "Tideland, season one. Everything here is kept alive by someone.", span: "month" }))
}

/** One round of village life. Each bot acts on its own houses; lamplighters tend every light. */
async function tick() {
  const w = await world()
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
else if (cmd === "loop") {
  const every = Number(arg ?? 20) * 60_000
  for (;;) { await safely("fund", () => fund()); await safely("tick", tick); await sleep(every) }
} else console.log("usage: bots.mjs wallets | fund [glm] | seed | tick | loop [minutes]")
process.exit(0)
