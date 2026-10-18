// A Tideland client with no SDK, no install and no Tideland code: plain JSON-RPC to Arkiv, written only from
// arkiv/schema.md. It answers "whose house sinks next, and who has been keeping it afloat?".
//   node examples/raw-consumer.mjs            (Node 18+; optional: ARKIV_ACCESS_KEY=... for a keyed quota)
// Copy it, change the queries, build your own bot, map or game on the same island. No permission needed.
const RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const headers = { "content-type": "application/json", ...(process.env.ARKIV_ACCESS_KEY ? { "X-API-KEY": process.env.ARKIV_ACCESS_KEY } : {}) }
const SELECT = { key: true, owner: true, creator: true, expiresAt: true, attributes: true, payload: true, creationFlags: true }

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
  if (r.status === 429) throw new Error("anonymous query budget used up: wait, or set ARKIV_ACCESS_KEY (see arkiv/friction.md #1)")
  const body = await r.json()
  if (body.error) throw new Error(`${body.error.code} ${body.error.message} ${body.error.data?.message ?? ""}`)
  return body.result
}

// Every page of a query, all read at ONE block: a cursor goes stale after a block (2 s), so pin with atBlock
// (arkiv/friction.md #10).
async function query(q) {
  const out = []
  let page = await rpc("arkiv_query", [q, { select: SELECT, limit: "0xc8" }])
  const atBlock = page.blockNumber
  if (page.cursor) page = await rpc("arkiv_query", [q, { select: SELECT, limit: "0xc8", atBlock }])
  for (;;) {
    for (const e of page.data) {
      const attrs = Object.fromEntries(e.attributes.map((a) => [a.name, a.value]))
      let data = {}
      try { data = JSON.parse(Buffer.from(e.payload.slice(2), "hex").toString("utf8")) } catch {}
      out.push({ ...e, expiresAt: BigInt(e.expiresAt), attrs, data })
    }
    if (!page.cursor) return out
    page = await rpc("arkiv_query", [q, { select: SELECT, limit: "0xc8", atBlock, cursor: page.cursor }])
  }
}

const head = BigInt(await rpc("eth_blockNumber", []))
const hours = (block) => (Number(block - head) * 2 / 3600).toFixed(1)
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`

const homes = (await query("app = str('tideland') AND world = str('s1') AND kind = str('home')")).sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1))
console.log(`Tideland at block ${head}: ${homes.length} homes, read straight from Arkiv\n`)
for (const h of homes.slice(0, 8)) {
  // Who kept it afloat: tend records point at the home; their $creator is the real signer and can't be forged.
  const tends = await query(`app = str('tideland') AND world = str('s1') AND kind = str('tend') AND home = key(${h.key})`)
  const keepers = [...new Set(tends.map((t) => t.creator))].filter((c) => c !== h.owner)
  console.log(`${String(h.data.islander ?? "?").padEnd(8)} ${String(h.data.name ?? "").padEnd(22)} (${h.attrs.x},${h.attrs.y}) ${h.attrs.style.padEnd(10)} sinks in ${hours(h.expiresAt).padStart(5)} h`)
  console.log(`         owner ${short(h.owner)} · kept afloat by ${keepers.length ? keepers.map(short).join(", ") : "nobody yet"}`)
}
