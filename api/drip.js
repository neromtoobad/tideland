// POST /api/drip { address } -> sends a little test GLM from the coast treasury to a new player's key.
// The only server-side code Tideland has. It never writes or reads world entities; it moves gas so
// players can sign their own writes (and so every house has its real builder as $creator).
import { createWalletClient, createPublicClient, http, isAddress, parseEther, formatEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { tiramisu } from "@arkiv-network/sdk/chains"

const AMOUNT = parseEther(process.env.DRIP_AMOUNT || "0.01")
const TOP_UP_BELOW = AMOUNT / 2n
const recent = new Map() // ip -> [timestamps], per warm instance

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" })
  const key = process.env.TREASURY_KEY
  if (!key) return res.status(503).json({ error: "The treasury is not configured yet." })
  const address = req.body?.address
  if (!isAddress(address)) return res.status(400).json({ error: "Send a valid address." })

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon"
  const now = Date.now(), hits = (recent.get(ip) || []).filter((t) => now - t < 3600_000)
  if (hits.length >= 3) return res.status(429).json({ error: "Three top-ups an hour per visitor. The tide can wait." })

  const pub = createPublicClient({ chain: tiramisu, transport: http() })
  const have = await pub.getBalance({ address })
  if (have >= TOP_UP_BELOW) return res.status(409).json({ error: `This key already has ${Number(formatEther(have)).toFixed(4)} GLM.` })

  const account = privateKeyToAccount(key)
  const treasury = await pub.getBalance({ address: account.address })
  if (treasury < AMOUNT * 2n) return res.status(503).json({ error: "The coast treasury is dry. Try again later." })

  const wallet = createWalletClient({ chain: tiramisu, transport: http(), account })
  const txHash = await wallet.sendTransaction({ to: address, value: AMOUNT })
  hits.push(now); recent.set(ip, hits)
  return res.status(200).json({ txHash, amount: formatEther(AMOUNT) })
}
