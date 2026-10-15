// GET /h/<key>: the shareable link for a house. Crawlers (X, WhatsApp, Telegram…) get a title with the
// live countdown and a playable card; people are sent straight on to the house page.
const RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.ARKIV_ACCESS_KEY ? { "X-API-KEY": process.env.ARKIV_ACCESS_KEY } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  return (await r.json()).result
}

function left(blocks) {
  const s = Math.max(0, blocks * 2), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

export default async function handler(req, res) {
  const key = String(req.query.key || "")
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return res.status(404).send("No such house")
  let name = "A house on the coast", title = "Keep it afloat", desc = "This house sinks unless someone holds the line."
  try {
    const [found, timing] = await Promise.all([
      rpc("arkiv_query", [`$key = key(${key})`, { select: { key: true, expiresAt: true, payload: true }, limit: "0x1" }]),
      rpc("arkiv_getBlockTiming", []),
    ])
    const e = found?.data?.[0]
    if (e) {
      const payload = JSON.parse(Buffer.from(String(e.payload).replace(/^0x/, ""), "hex").toString("utf8") || "{}")
      name = payload.name || name
      const rest = Number(BigInt(e.expiresAt)) - Number(timing.current_block)
      title = rest > 0 ? `${name} sinks in ${left(rest)}` : `${name} has sunk`
      desc = rest > 0 ? "Hold to keep it afloat. Every save is signed on Arkiv." : "Nobody kept it afloat in time."
    }
  } catch { /* fall back to the generic card */ }
  const origin = `https://${req.headers.host}`
  const page = `${origin}/?h=${key}`
  res.setHeader("content-type", "text/html; charset=utf-8")
  res.setHeader("cache-control", "public, max-age=60")
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} · Tideland</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${origin}/card.png"><meta property="og:url" content="${origin}/h/${key}">
<meta name="twitter:card" content="player"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${origin}/card.png">
<meta name="twitter:player" content="${origin}/?embed=1&amp;h=${key}"><meta name="twitter:player:width" content="600"><meta name="twitter:player:height" content="600">
<meta http-equiv="refresh" content="0; url=${page}">
</head><body><a href="${page}">${esc(title)}</a><script>location.replace(${JSON.stringify(page)})</script></body></html>`)
}
