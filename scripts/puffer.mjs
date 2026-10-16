#!/usr/bin/env node
// Puffer Pass from the terminal: three bots play a whole table on Tiramisu, and every step is checked
// against resolveTable(), the same rules the web client runs.
//
//   node scripts/puffer.mjs smoke        open a table, seat three bots, play it out, pay the winner
//   node scripts/puffer.mjs show <key>   print what the rules say about a table
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { keccak256, toHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  publicClient, walletClient, collect, homesQuery, tableQuery, resolveTable, openTable, takeSeat, servePuffer,
  passPuffer, popPuffer, toThing, PUFFER, blocksToText,
} from "../shared/tideland.js"

const file = (n) => `${homedir()}/.tideland/${n}`
if (!process.env.ARKIV_ACCESS_KEY && existsSync(file("access.key"))) process.env.ARKIV_ACCESS_KEY = readFileSync(file("access.key"), "utf8").trim()
const seed = process.env.BOT_SEED?.trim() || readFileSync(file("bots.seed"), "utf8").trim()
const pub = publicClient()
const bots = [...Array(9).keys()].map((i) => { const account = privateKeyToAccount(keccak256(toHex(`${seed}:tideland-bot:${i}`))); return { i, account, wallet: walletClient(account) } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const head = async () => (await pub.getBlockTiming()).currentBlock
const lc = (a) => a.toLowerCase()

async function read(tableKey) {
  const table = toThing(await pub.getEntity(tableKey))
  const recs = await collect(tableQuery(pub, tableKey))
  return resolveTable(table, recs, await head())
}
const say = (g) => console.log(`  phase=${g.phase} round=${g.round} seats=${g.seats.length} alive=${g.alive.map((s) => s.name).join(",")} holder=${g.current?.holder?.slice(0, 8) ?? "-"} pot=${g.pot}m`)

async function smoke() {
  const h = await head()
  const homes = (await collect(homesQuery(pub))).filter((x) => x.expiresAt > h)
  const players = bots.map((b) => ({ ...b, home: homes.find((x) => lc(x.owner) === lc(b.account.address)) })).filter((b) => b.home).slice(0, 3)
  if (players.length < 3) throw new Error("need three bots with live homes")
  const [a, b, c] = players
  console.log("players:", players.map((p) => `${p.home.data.islander} ${p.account.address.slice(0, 8)} house ${blocksToText(p.home.expiresAt - h)}`).join(" | "))

  const t = await openTable(a.wallet, pub, { home: a.home, name: "Smoke test" })
  console.log("table", t.tableKey, t.txHash)
  await Promise.all([takeSeat(b.wallet, { table: t.tableKey, home: b.home }), takeSeat(c.wallet, { table: t.tableKey, home: c.home })])
  await sleep(1500)
  let g = await read(t.tableKey); say(g)
  if (g.seats.length !== 3 || g.phase !== "lobby") throw new Error("expected three seats in the lobby")

  // round 1: a serves to b, b passes to c, c holds it until it pops
  const s1 = await servePuffer(a.wallet, pub, { table: t.tableKey, round: 1, to: b.account.address, fuseSeconds: 20 })
  console.log("served", s1.puffer, "fuse block", s1.fuse)
  await passPuffer(b.wallet, { table: t.tableKey, puffer: s1.puffer, round: 1, to: c.account.address })
  await sleep(1500)
  g = await read(t.tableKey); say(g)
  if (g.current?.holder !== lc(c.account.address)) throw new Error("c should hold the puffer")
  while ((await head()) < s1.fuse) await sleep(2000)
  g = await read(t.tableKey); say(g)
  if (g.last?.holder !== lc(c.account.address) || g.phase !== "between") throw new Error("c should have popped")
  // the loser records the pop (and serves the next one)
  await popPuffer(c.wallet, pub, { table: t.tableKey, round: 1, puffer: s1.puffer, loser: c.account.address, loserHome: c.home.key })
  const s2 = await servePuffer(c.wallet, pub, { table: t.tableKey, round: 2, to: a.account.address, fuseSeconds: 20 })
  console.log("round 2 served", s2.puffer)
  // a passes to b; b tries to bounce it straight back (allowed with two left), then keeps it
  await passPuffer(a.wallet, { table: t.tableKey, puffer: s2.puffer, round: 2, to: b.account.address })
  while ((await head()) < s2.fuse) await sleep(2000)
  g = await read(t.tableKey); say(g)
  if (!g.winner || g.winner.player !== lc(a.account.address)) throw new Error("a should have won")
  const winnerHome = toThing(await pub.getEntity(a.home.key))
  const paid = await popPuffer(b.wallet, pub, { table: t.tableKey, round: 2, puffer: s2.puffer, loser: b.account.address, loserHome: b.home.key, winnerHome, potMinutes: g.pot })
  console.log(`final pop + win: +${paid.minutes} min on ${a.home.data.islander}'s house`, paid.txHash)
  await sleep(1500)
  g = await read(t.tableKey); say(g)
  console.log("win record", g.win?.key, "pops recorded", g.pops.map((p) => !!p.record))
  const after = toThing(await pub.getEntity(a.home.key))
  console.log("house now", blocksToText(after.expiresAt - (await head())), "(was", blocksToText(winnerHome.expiresAt - (await head())) + ")")
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === "smoke") await smoke()
else if (cmd === "show") { const g = await read(arg); say(g); console.log(g) }
else console.log("usage: node scripts/puffer.mjs smoke | show <tableKey>")
