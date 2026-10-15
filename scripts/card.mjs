// Builds web/public/card.png, the 1200x630 share image for house links, from the game's own sprites.
import sharp from "sharp"
const W = 1200, H = 630
const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef3f1"/><stop offset="1" stop-color="#f3ede0"/></linearGradient>
  <linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb7ae" stop-opacity=".85"/><stop offset="1" stop-color="#4c8c84"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="70" y="190" font-family="Georgia, serif" font-size="92" fill="#1b2b2a">Keep it afloat</text>
  <text x="74" y="258" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#5e7472">This house sinks unless</text>
  <text x="74" y="302" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#5e7472">someone holds the line.</text>
  <text x="74" y="380" font-family="Menlo, monospace" font-size="26" fill="#1f6e68" font-weight="bold">TIDELAND · on Arkiv</text>
</svg>`)
const water = Buffer.from(`<svg width="1200" height="190" xmlns="http://www.w3.org/2000/svg"><path d="M0 30 Q 75 0 150 30 T 300 30 T 450 30 T 600 30 T 750 30 T 900 30 T 1050 30 T 1200 30 V190 H0Z" fill="#7fb7ae" fill-opacity=".85"/></svg>`)
const house = await sharp("web/public/sprites/stone.webp").resize({ width: 470 }).toBuffer()
await sharp(bg).composite([
  { input: house, left: 680, top: 110 },
  { input: water, left: 0, top: 440 },
]).png().toFile("web/public/card.png")
console.log("web/public/card.png")
