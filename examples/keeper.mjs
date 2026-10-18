// A stranger's keeper bot. It is not one of our guild bots, it has nothing from us but this repo, and it needs nobody's
// permission: homes are created with permissionlessExtension, so any key can keep any house afloat.
// It finds the house that sinks soonest (skipping houses flooded by a Puffer Pass pop, as the rules ask), adds an hour of
// life, and signs a `tend` record in the same transaction, so "kept afloat by" shows YOUR address on every client.
//
//   node examples/keeper.mjs --dry          # show which house it would save, write nothing
//   node examples/keeper.mjs                # save one house (needs a little test GLM, see below)
//   node examples/keeper.mjs --loop         # keep going, one save every 20 minutes
//   node examples/keeper.mjs --drip         # ask tideland.nerom.site for test GLM (rate-limited; or use the Arkiv faucet)
//
// Your key: KEEPER_KEY=0x... in the environment, or a new one is made and kept in ./.keeper.key (gitignored; never share it).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { formatEther } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { collect, floodOf, homesQuery, keepAfloat, lifeQuery, publicClient, walletClient } from "../shared/tideland.js"

const args = new Set(process.argv.slice(2))
const KEYFILE = ".keeper.key"
const key = process.env.KEEPER_KEY || (existsSync(KEYFILE) ? readFileSync(KEYFILE, "utf8").trim() : (() => { const k = generatePrivateKey(); writeFileSync(KEYFILE, k, { mode: 0o600 }); return k })())
const account = privateKeyToAccount(key)
const reader = publicClient()
const wallet = walletClient(account)
const ONE_HOUR = 1800n // blocks (2 s each)
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`

async function balance() { return reader.getBalance({ address: account.address }) }

async function drip() {
  const r = await fetch("https://tideland.nerom.site/api/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account.address }) })
  const body = await r.json().catch(() => ({}))
  console.log(r.ok ? `test GLM on its way: ${body.txHash}` : `drip refused: ${body.error}. Use the Arkiv faucet instead (hub.arkiv.network) and send it to ${account.address}.`)
}

async function saveOne() {
  const head = (await reader.getBlockTiming()).currentBlock
  const homes = (await collect(homesQuery(reader))).filter((h) => h.expiresAt > head && h.owner.toLowerCase() !== account.address.toLowerCase())
  homes.sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1))
  for (const home of homes) {
    const life = await collect(lifeQuery(reader, home.key))
    const flood = floodOf(life, head)
    const hours = (Number(home.expiresAt - head) * 2 / 3600).toFixed(1)
    const who = `${home.data.name ?? "a house"} (${home.data.islander ?? "an islander"}, owner ${short(home.owner)})`
    if (flood) { console.log(`skip  ${who}: flooded by a Puffer Pass pop, nobody shores it up until the water drains`); continue }
    if (args.has("--dry")) { console.log(`would save ${who}: sinks in ${hours} h → +1 h`); return }
    const r = await keepAfloat(wallet, reader, { home, addBlocks: ONE_HOUR, note: "Kept afloat by a stranger's keeper bot" })
    if (r.full) { console.log(`full  ${who}: already at its level's cap`); continue }
    console.log(`saved ${who}: sank in ${hours} h, +${Math.round(r.minutes)} min · tx ${r.txHash}`)
    console.log(`      https://tiramisu.explorer.arkiv.network/tx/${r.txHash}`)
    return
  }
  console.log("Every house is either flooded or full. The island is in good hands.")
}

console.log(`keeper ${account.address} · ${formatEther(await balance())} GLM`)
if (args.has("--drip")) await drip()
else if (!args.has("--dry") && (await balance()) === 0n) console.log("This key has no test GLM yet: run with --drip, or use the Arkiv faucet. Try --dry meanwhile.")
else if (args.has("--loop")) for (;;) { await saveOne().catch((e) => console.log("error:", e.shortMessage ?? e.message)); await new Promise((r) => setTimeout(r, 20 * 60 * 1000)) }
else await saveOne()
