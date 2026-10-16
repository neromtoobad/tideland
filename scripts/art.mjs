// Turns the raw 1024px Higgsfield renders in art/raw into trimmed, game-sized WebP sprites in web/public/sprites,
// plus a contact sheet for review. Sprites keep their alpha; nothing is re-generated here.
import sharp from "sharp"
import { readdirSync, mkdirSync } from "node:fs"
const RAW = "art/raw", OUT = "web/public/sprites"
mkdirSync(OUT, { recursive: true })
const names = readdirSync(RAW).filter((f) => f.endsWith(".png") && !f.startsWith("sheet-")).map((f) => f.slice(0, -4)).sort()

// Walk-cycle sheets: sheet-<look>-walk.png holds 4 frames in a row. Each frame is cut from its column and
// cropped to ONE shared box (the union of all four), so the character doesn't jitter between frames.
async function bbox(buf, width, height) {
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let x0 = width, y0 = height, x1 = 0, y1 = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return { x0, y0, x1, y1 }
}
for (const f of readdirSync(RAW).filter((f) => /^sheet-.*-walk\.png$/.test(f))) {
  const look = f.slice(6, -9)
  const meta = await sharp(`${RAW}/${f}`).metadata()
  const colW = Math.floor(meta.width / 4)
  const cols = await Promise.all([0, 1, 2, 3].map((i) => sharp(`${RAW}/${f}`).extract({ left: i * colW, top: 0, width: colW, height: meta.height }).png().toBuffer()))
  const boxes = await Promise.all(cols.map((c) => bbox(c, colW, meta.height)))
  const u = { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) }
  for (const [i, c] of cols.entries()) {
    await sharp(c).extract({ left: u.x0, top: u.y0, width: u.x1 - u.x0 + 1, height: u.y1 - u.y0 + 1 }).resize({ width: 192, withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 95 }).toFile(`${OUT}/${look}-walk-${i}.webp`)
  }
  console.log(`${look}-walk  4 frames, box ${u.x1 - u.x0 + 1}x${u.y1 - u.y0 + 1}`)
}
const tiles = []
for (const n of names) {
  const isChar = /carpenter|mason|lamplighter|fisher|weaver|baker|sailor|kid|elder|stew|deco|boat/.test(n)
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
