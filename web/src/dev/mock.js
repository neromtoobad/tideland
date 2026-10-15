// DEV ONLY (?mock=1 on the Vite dev server): a synthetic coast for tuning the renderer before any
// entity exists. Never shipped: main.js imports it behind import.meta.env.DEV.
import { MATERIALS, lifetimeBlocks, PARCEL_SECONDS } from "../../../shared/tideland.js"
export function mockThings(head) {
  const out = [], rnd = mulberry(7)
  const guilds = [
    { key: "0xg1", kind: "guild", data: { name: "Tidewrights", color: "#1F6E68" }, expiresAt: head + 900000n, owner: "0xA1", creator: "0xA1" },
    { key: "0xg2", kind: "guild", data: { name: "Granite Hands", color: "#B4552E" }, expiresAt: head + 900000n, owner: "0xB2", creator: "0xB2" },
    { key: "0xg3", kind: "guild", data: { name: "Lamplighters", color: "#96762B" }, expiresAt: head + 9000n, owner: "0xC3", creator: "0xC3" },
  ]
  out.push(...guilds)
  const mats = Object.keys(MATERIALS)
  let n = 0
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (rnd() > 0.22) continue
    const material = mats[Math.floor(rnd() * mats.length)]
    const span = lifetimeBlocks(MATERIALS[material].seconds)
    const left = BigInt(Math.floor(Number(span) * (0.02 + rnd() * 0.98)))
    const g = guilds[Math.floor(rnd() * 3)]
    const pk = `0xp${n}`, who = ["0xA1", "0xB2", "0xC3", "0xD4"][Math.floor(rnd() * 4)]
    out.push({ key: pk, kind: "parcel", x, y, owner: who, creator: who, createdAt: BigInt(n), expiresAt: head + lifetimeBlocks(PARCEL_SECONDS), data: { name: "Plot" }, guild: g.key })
    if (rnd() > 0.1) out.push({ key: `0xs${n.toString(16).padStart(4, "0")}`, kind: "structure", x, y, material, parcel: pk, guild: g.key, owner: who, creator: rnd() > 0.8 ? "0xE5" : who, createdAt: BigInt(n), expiresAt: head + (rnd() > 0.85 ? BigInt(Math.floor(rnd() * 5000)) : left), flags: MATERIALS[material].flags, data: { name: `${MATERIALS[material].label} ${n}` } })
    n++
  }
  return out
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
