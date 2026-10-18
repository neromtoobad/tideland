// POST /api/rpc — a read-only JSON-RPC relay, used by the web client ONLY when the visitor's own
// anonymous Arkiv budget is exhausted (HTTP 429 ANON_COST_LIMITED). The client always tries Arkiv's
// public RPC directly first. Writes cannot pass: only the read methods below are forwarded.
import { keyedFetch } from "../shared/tideland.js"

const UPSTREAM = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const READS = new Set(["arkiv_query", "arkiv_getBlockTiming", "arkiv_getEntityCount", "eth_chainId", "eth_blockNumber",
  "eth_getBalance", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_call",
  "eth_getTransactionCount", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_estimateGas"])

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" })
  const body = req.body
  const calls = Array.isArray(body) ? body : [body]
  if (!calls.length || calls.length > 20 || calls.some((c) => !READS.has(c?.method))) {
    return res.status(400).json({ error: "read-only relay: method not allowed" })
  }
  // our key when it has quota left, otherwise this server's own anonymous budget
  const r = await keyedFetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  res.status(r.status).setHeader("content-type", "application/json")
  return res.send(await r.text())
}
