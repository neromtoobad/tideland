// Player wallets. Each player signs their own writes, so every house's $creator is a real, distinct
// author. Default is a local key kept in this browser (test GLM only); "Use my wallet" swaps in an
// injected EIP-1193 wallet. The only server Tideland has is /api/drip, which tops up test GLM.
import { createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { custom, formatEther, http } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const STORE = "tideland.localKey"

function readKey() {
  try { return localStorage.getItem(STORE) } catch { return null }
}
function writeKey(k) {
  try { localStorage.setItem(STORE, k) } catch {}
}

export function localWallet() {
  let k = readKey()
  if (!k) { k = generatePrivateKey(); writeKey(k) }
  const account = privateKeyToAccount(k)
  return { kind: "local", address: account.address, client: createWalletClient({ chain: tiramisu, transport: http(), account }) }
}

export async function injectedWallet() {
  const eth = window.ethereum
  if (!eth) throw new Error("No browser wallet found. The built-in local wallet works without one.")
  const [address] = await eth.request({ method: "eth_requestAccounts" })
  const chainId = "0x" + tiramisu.id.toString(16)
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] })
  } catch (e) {
    if (e?.code !== 4902) throw e
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: "Arkiv Tiramisu", nativeCurrency: tiramisu.nativeCurrency, rpcUrls: tiramisu.rpcUrls.default.http, blockExplorerUrls: ["https://tiramisu.explorer.arkiv.network"] }],
    })
  }
  return { kind: "injected", address, client: createWalletClient({ chain: tiramisu, transport: custom(eth), account: address }) }
}

export async function balanceOf(pub, address) {
  const wei = await pub.getBalance({ address })
  return { wei, text: Number(formatEther(wei)).toFixed(4) + " GLM" }
}

export async function drip(address) {
  const r = await fetch("/api/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || `drip failed (${r.status})`)
  return body
}
