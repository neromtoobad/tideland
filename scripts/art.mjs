// Turns the raw 1024px Higgsfield renders in art/raw into trimmed, game-sized WebP sprites in web/public/sprites,
// plus a contact sheet for review. Sprites keep their alpha; nothing is re-generated here.
import sharp from "sharp"
import { readdirSync, mkdirSync } from "node:fs"
const RAW = "art/raw", OUT = "web/public/sprites"
mkdirSync(OUT, { recursive: true })
const names = readdirSync(RAW).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort()
const tiles = []
for (const n of names) {
  const isChar = /carpenter|mason|lamplighter/.test(n)
  const img = sharp(`${RAW}/${n}.png`).trim({ threshold: 2 })
  const buf = await img.resize({ width: isChar ? 192 : 384, withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 95 }).toBuffer()
  await sharp(buf).toFile(`${OUT}/${n}.webp`)
  const m = await sharp(buf).metadata()
  console.log(n.padEnd(18), `${m.width}x${m.height}`)
  tiles.push({ n, buf })
}
// contact sheet on a light background
const cell = 260, cols = 5, rows = Math.ceil(tiles.length / cols)
const comps = await Promise.all(tiles.map(async (t, i) => ({ input: await sharp(t.buf).resize({ width: 240, height: 240, fit: "inside" }).toBuffer(), left: (i % cols) * cell + 10, top: Math.floor(i / cols) * cell + 10 })))
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: "#EFF3F1" } }).composite(comps).png().toFile("art/contact.png")
