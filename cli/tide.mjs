#!/usr/bin/env node
// A second, independent Tideland client. It shares nothing with the web app except the public data
// contract in shared/tideland.js, and talks to nobody but Arkiv's public RPC.
//
//   node cli/tide.mjs map              the whole coast, top-down
//   node cli/tide.mjs tide [hours]     what sinks next (default: 24 h)
//   node cli/tide.mjs cell <x> <y>     everything on one cell
//   node cli/tide.mjs legacy <0xaddr>  what an address built ($creator) and holds ($owner)
//   node cli/tide.mjs guilds           charters and their standing footprint
import {
  SIZE, MATERIALS, publicClient, collect, worldQuery, tideQuery, legacyQuery, estateQuery, guildsQuery,
  guildFootprintQuery, layout, blocksToText,
} from "../shared/tideland.js"

const pub = publicClient()
const [cmd = "map", ...args] = process.argv.slice(2)
const { currentBlock: head } = await pub.getBlockTiming()
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "-")
const GLYPH = { driftwood: "d", pine: "P", stone: "S", monument: "M", lighthouse: "L" }
const c = { dim: "\x1b[2m", red: "\x1b[31m", teal: "\x1b[36m", gold: "\x1b[33m", off: "\x1b[0m" }

if (cmd === "map") {
  const query = worldQuery(pub)
  const things = (await collect(query)).filter((t) => t.expiresAt > head)
  const cells = layout(things)
  console.log(`${c.dim}${query.toString()}${c.off}`)
  console.log(`Tideland s1 · block ${head} · ${things.length} live entities\n`)
  console.log("    " + [...Array(SIZE).keys()].map((x) => String(x % 10)).join(" "))
  for (let y = 0; y < SIZE; y++) {
    let row = String(y).padStart(3) + " "
    for (let x = 0; x < SIZE; x++) {
      const cell = cells.get(`${x}:${y}`)
      const s = cell?.structure
      let ch = `${c.dim}·${c.off}`
      if (s) {
        const left = s.expiresAt - head
        const color = left < 43200n ? c.red : s.material === "lighthouse" ? c.gold : c.teal
        ch = `${color}${GLYPH[s.material] ?? "?"}${c.off}`
      } else if (cell?.parcel) ch = "□"
      else if (cell?.inscriptions.length) ch = "†"
      row += ch + " "
    }
    console.log(row)
  }
  console.log(`\n${Object.entries(GLYPH).map(([m, g]) => `${g}=${m}`).join("  ")}  □=claimed land  †=inscription  ${c.red}red${c.off}=sinks within a day`)
} else if (cmd === "tide") {
  const hours = Number(args[0] ?? 24)
  const query = tideQuery(pub, head, BigInt(Math.round(hours * 1800)))
  const sinking = (await collect(query)).filter((t) => t.expiresAt > head).sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1))
  console.log(`${c.dim}${query.toString()}${c.off}\n`)
  for (const t of sinking) {
    const what = t.kind === "structure" ? `${t.data.name ?? MATERIALS[t.material]?.label} (${t.material})` : t.kind === "inscription" ? `"${t.data.text}"` : `${t.data.name ?? ""} (${t.kind})`
    console.log(`${blocksToText(t.expiresAt - head).padStart(10)}  ${t.x ?? "-"},${t.y ?? "-"}  ${what}  held by ${short(t.owner)}`)
  }
  if (!sinking.length) console.log("Nothing sinks in that window.")
} else if (cmd === "cell") {
  const [x, y] = args.map(Number)
  const query = worldQuery(pub, { x0: x, x1: x, y0: y, y1: y })
  const things = await collect(query)
  console.log(`${c.dim}${query.toString()}${c.off}\n`)
  for (const t of things) console.log(`${t.kind.padEnd(12)} ${t.material ?? ""}  ${JSON.stringify(t.data)}\n             built by ${t.creator} · held by ${t.owner} · sinks in ${blocksToText(t.expiresAt - head)} · ${t.key}`)
  if (!things.length) console.log("Open coast.")
} else if (cmd === "legacy") {
  const who = args[0]
  const built = await collect(legacyQuery(pub, who)), held = await collect(estateQuery(pub, who))
  console.log(`${c.dim}${legacyQuery(pub, who).toString()}${c.off}`)
  console.log(`Built by ${who} (${built.length}):`)
  for (const t of built) console.log(`  ${t.material.padEnd(10)} ${t.x},${t.y}  ${t.data.name ?? ""}  ${t.owner.toLowerCase() === who.toLowerCase() ? "" : `→ now held by ${short(t.owner)}`}`)
  console.log(`${c.dim}${estateQuery(pub, who).toString()}${c.off}`)
  console.log(`Land held (${held.length}):`)
  for (const t of held) console.log(`  ${t.x},${t.y}  ${t.data.name ?? ""}  lease ${blocksToText(t.expiresAt - head)}`)
} else if (cmd === "guilds") {
  for (const g of await collect(guildsQuery(pub))) {
    const n = (await collect(guildFootprintQuery(pub, g.key))).length
    console.log(`${g.data.name.padEnd(16)} ${String(n).padStart(3)} standing  charter lapses in ${blocksToText(g.expiresAt - head)}  founded by ${short(g.creator)}`)
  }
} else {
  console.log("usage: node cli/tide.mjs map | tide [hours] | cell <x> <y> | legacy <0xaddr> | guilds")
}
