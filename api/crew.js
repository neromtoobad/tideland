// POST /api/crew — the island's crew sits at your Puffer Pass table so you never play alone.
// The crew are the same nine guild bots that live on the island (scripts/bots.mjs): each has its own
// wallet and house, signs its own seat, passes and pops, and stakes its own house exactly like you.
// The browser at the table decides WHEN a bot moves (a human-ish delay) and asks this endpoint to sign;
// the rules are still checked by everyone from the records, and a bot can only pass a puffer it owns.
//   { op: "fill", table, count }                       seat up to `count` bots with live houses
//   { op: "pass", bot, table, puffer, round, to }      a bot passes the puffer it holds
//   { op: "serve", bot, table, round, to, fuseSeconds } a popped bot serves the next puffer
//   { op: "pop", bot, table, round, puffer, loser, loserHome, winnerHome, potMinutes }  a bot records a pop
import { keccak256, toHex, isAddress } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  publicClient, walletClient, collect, homesQuery, tableQuery, resolveTable, takeSeat, servePuffer, passPuffer,
  popPuffer, toThing, PUFFER,
} from "../shared/tideland.js"

const KEY = /^0x[0-9a-fA-F]{64}$/
const recent = new Map() // ip -> timestamps, per warm instance

function crew() {
  const seed = process.env.BOT_SEED?.trim()
  if (!seed) return null
  return [...Array(9).keys()].map((i) => privateKeyToAccount(keccak256(toHex(`${seed}:tideland-bot:${i}`))))
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" })
  const accounts = crew()
  if (!accounts) return res.status(503).json({ error: "The crew is off duty (no BOT_SEED)." })
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon"
  const now = Date.now(), hits = (recent.get(ip) || []).filter((t) => now - t < 60_000)
  if (hits.length >= 90) return res.status(429).json({ error: "The crew needs a breather." })
  hits.push(now); recent.set(ip, hits)

  const b = req.body || {}
  if (b.op === "who") return res.status(200).json({ crew: accounts.map((a) => a.address) })
  if (!KEY.test(b.table || "")) return res.status(400).json({ error: "Send a table key." })
  const pub = publicClient()
  const wallet = (address) => {
    const a = accounts.find((x) => x.address.toLowerCase() === String(address).toLowerCase())
    if (!a) throw Object.assign(new Error("Not one of the crew."), { status: 400 })
    return walletClient(a)
  }
  try {
    if (b.op === "fill") {
      const head = (await pub.getBlockTiming()).currentBlock
      const [table, recs, homes] = [toThing(await pub.getEntity(b.table)), await collect(tableQuery(pub, b.table)), await collect(homesQuery(pub))]
      const g = resolveTable(table, recs, head)
      if (g.phase !== "lobby") return res.status(409).json({ error: "That table has already started." })
      const seated = new Set(g.seats.map((s) => s.player))
      const want = Math.max(0, Math.min(Number(b.count) || 3, PUFFER.maxSeats - g.seats.length))
      // the crew with houses that can afford the flood, in a different order each time
      const free = accounts.map((a) => ({ a, home: homes.find((h) => h.owner?.toLowerCase() === a.address.toLowerCase() && h.expiresAt > head + 1800n) }))
        .filter((x) => x.home && !seated.has(x.a.address.toLowerCase())).sort(() => Math.random() - 0.5).slice(0, want)
      const done = await Promise.allSettled(free.map((x) => takeSeat(walletClient(x.a), { table: b.table, home: x.home })))
      return res.status(200).json({ seated: free.filter((_, i) => done[i].status === "fulfilled").map((x) => x.a.address) })
    }
    if (!isAddress(b.bot || "")) return res.status(400).json({ error: "Which bot?" })
    const w = wallet(b.bot)
    if (b.op === "pass") {
      if (!KEY.test(b.puffer || "") || !isAddress(b.to || "")) return res.status(400).json({ error: "Pass what, to whom?" })
      const r = await passPuffer(w, { table: b.table, puffer: b.puffer, round: Number(b.round), to: b.to })
      return res.status(200).json({ txHash: r.txHash })
    }
    if (b.op === "serve") {
      if (!isAddress(b.to || "")) return res.status(400).json({ error: "Serve to whom?" })
      const [lo, hi] = PUFFER.fuseSeconds
      const r = await servePuffer(w, pub, { table: b.table, round: Number(b.round), to: b.to, fuseSeconds: Math.max(lo, Math.min(hi, Number(b.fuseSeconds) || lo)) })
      return res.status(200).json({ txHash: r.txHash, puffer: r.puffer })
    }
    if (b.op === "pop") {
      if (!KEY.test(b.puffer || "") || !KEY.test(b.loserHome || "") || !isAddress(b.loser || "")) return res.status(400).json({ error: "Which pop?" })
      const winnerHome = KEY.test(b.winnerHome || "") ? toThing(await pub.getEntity(b.winnerHome)) : null
      const r = await popPuffer(w, pub, { table: b.table, round: Number(b.round), puffer: b.puffer, loser: b.loser, loserHome: b.loserHome, winnerHome, potMinutes: Number(b.potMinutes) || 0 })
      return res.status(200).json({ txHash: r.txHash, minutes: r.minutes })
    }
    return res.status(400).json({ error: "Unknown op." })
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.shortMessage || e.message).slice(0, 300) })
  }
}
