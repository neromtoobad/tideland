# Friction report (`/arkiv/friction.md`)

What got in the way while building Tideland, and what worked, with versions and steps to reproduce. Every item below
was hit or measured during this build (15 Oct 2026). Nothing is hypothetical.

**Environment:** `@arkiv-network/sdk` 0.8.1 · `viem` 2.57.7 · Node 24.21.0 (macOS) · Chrome (Claude desktop browser pane) ·
Tiramisu testnet, public RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.

## Summary, ordered by impact on users

| # | Issue | Impact on Tideland | Status |
|---|---|---|---|
| 1 | 429 + long `Retry-After` is silently slept through by the default transport ([#126](https://github.com/Arkiv-Network/arkiv-sdk-js/issues/126)) | The game froze for minutes; looked like an outage | Worked around (`retryCount: 0`, relay) |
| 10 | `next()` goes stale after one 2-s block unless the query is pinned with `.atBlock()` ([#125](https://github.com/Arkiv-Network/arkiv-sdk-js/issues/125)) | 15 s blank first screen; failed bot runs | Fixed by pinning |
| 2 | Query cost (100 units flat, 10,000 anonymous window) is undocumented and hidden | Our first client burned a visitor's budget in under an hour | Worked around (one debounced re-read) |
| 7 | `readonly` doesn't freeze expiry | The puffer's holder could have extended the fuse | Worked around (`fuse` attribute) |
| 4 | `ExpiryExtended` names the owner, not the extender ([#127](https://github.com/Arkiv-Network/arkiv-sdk-js/issues/127)) | One extra `getTransaction` per event to show who tended | Worked around |
| 8 | No event when an entity expires | Every client estimates "it popped" from the head block | Worked around |
| 3 | `predictEntityKeys` missing on the wallet client | Confusing, cheap | Worked around |
| 5, 6 | Faucet pays only the signed-in wallet; stale README snippets | Minor | Noted |

**The one thing we'd fix first:** make every query failure say what happened and never hang: a typed `QueryError` kind
for budget/rate limits (429, `ANON_COST_LIMITED`) and for stale cursors, a default transport that doesn't sleep through
`Retry-After`, and `next()` that pins to its page's block. Items 1, 2b and 10 all come from those three gaps.

---

## 1. An exhausted anonymous budget looks like a 27-minute hang, not an error

**Filed upstream:** [arkiv-sdk-js#126](https://github.com/Arkiv-Network/arkiv-sdk-js/issues/126)

**Surface:** public RPC rate limiting + SDK default transport (`http()` from viem).

**Expected:** when the anonymous query budget is used up, `select().where(...).fetch()` rejects quickly with an error
that says so, so the app can show a message or switch to a keyed endpoint.

**Actual:** the call never returned. Our CLI sat silent for more than 120 s and we killed it. The node had answered
immediately with:

```
HTTP/2 429
ratelimit: limit=10000, remaining=0, reset=1632
retry-after: 1632
{"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}
```

viem's default `http()` transport retries, and honours `Retry-After`, so it slept for 1,632 s (27 min) before its
retry. The SDK's `asQueryError` does not recognise the case either (no JSON-RPC `code`), so the raw viem
`HttpRequestError` is what eventually surfaces, three levels down a `cause` chain.

**Steps to reproduce:**
1. From one IP, run ~100 `arkiv_query` calls anonymously (each costs 100 units, see item 2).
2. `await createPublicClient({ chain: tiramisu, transport: http() }).select().where(eq("app", "x")).fetch()`
3. It hangs for the `Retry-After` period. With `http(undefined, { retryCount: 0 })` the same call rejects in ~1 s
   (we measured 998 ms).

**What would fix it:** have the SDK's default transport not retry 429s (or cap the `Retry-After` it honours), and map
HTTP 429 / `ANON_COST_LIMITED` to a typed `QueryError` kind such as `"budget"`. Our workaround is in
[`shared/tideland.js`](../shared/tideland.js) (`retryCount: 0` and an `isBudgetError()` that walks `cause`).

## 2. The query cost model is invisible until you hit it

**Surface:** RPC cost accounting (`Arkiv-Cost`, `RateLimit` response headers).

**Expected:** a documented cost per query, so a client that polls can be budgeted.

**Actual (measured with an access key):** every `arkiv_query` we sent cost a flat **100 units**, whether it returned
114 entities with payloads or 29. The anonymous limit reported by the `RateLimit` header is **10,000 units** per
window, so a visitor gets about 100 queries per window. Our first web client re-read the world every 30 s and fetched each changed entity with
`getEntity` (also an `arkiv_query`), which burned our dev IP's budget in well under an hour. The headers are there
(`Arkiv-Cost`, `Arkiv-Quota-Used-Percent`) but the SDK does not expose them and the docs we found do not state the cost.

**Steps to reproduce:** `curl -D - -X POST <rpc> -H 'X-API-KEY: <key>' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["app = str(\'tideland\')",{"limit":"0xc8"}]}'`
and read `arkiv-cost`.

**What would fix it:** document the per-query cost and the anonymous window; surface `Arkiv-Cost` on `QueryResult`.
**What we changed:** one debounced world re-read per burst of WebSocket events instead of one `getEntity` per event,
and a slow 5-minute safety refresh. Browsers read Arkiv directly and fall back to a read-only relay (with our key) only
when *their* anonymous budget is exhausted; the page says "via relay" when that happens.

## 2b. A second rejection shape: JSON-RPC `-32005` on cursor pages

**Surface:** `arkiv_query` pagination (`QueryResult.next()`).

**Expected:** the same 429 / budget signal as item 1, or a page.

**Actual (16 Oct, world of ~220 entities, 2 pages):** intermittently the second page came back as
`QueryError: Query rejected (cursor, -32005): Request exceeds defined limit`, both on the anonymous endpoint and once
through our keyed relay right after a burst of parallel reads. The same query a few seconds later succeeded (219
entities in 2 pages, keyed). We could not tell from the error whether a budget, a rate limit, or a cursor limit was hit.

**What would fix it:** document `-32005` (what limit, and whether to retry), and give it a distinct `QueryError` kind
instead of `cursor`. **Workaround:** [`collect()`](../shared/tideland.js) retries `-32005` with a short backoff, reads run
one after another instead of in parallel, and the page treats `-32005` like a 429 when choosing the relay.

**Update, 18 Oct:** we found the cause. The error's `data.message` says the cursor belongs to an older block: see
item 10. Retrying the same cursor was the wrong fix; pinning the query with `.atBlock()` is the right one.

## 3. `predictEntityKeys` is not on the wallet client

**Filed upstream** by another team: [arkiv-sdk-js#123](https://github.com/Arkiv-Network/arkiv-sdk-js/issues/123) (we hit the same thing independently)

**Surface:** `createWalletClient` actions.

**Expected:** the wallet client's JSDoc says it offers mutations "on top of the read actions a Public Client has", so
`wallet.predictEntityKeys({ owner, count: 2 })` should work before `wallet.executeBatch(...)`.

**Actual:** `TypeError: wallet.predictEntityKeys is not a function`. It exists only on the public client
(`decorators/arkivPublic.ts`); the example in its own JSDoc uses `client.predictEntityKeys` then `wallet.executeBatch`.

**Steps to reproduce:** `const w = createWalletClient({ chain: tiramisu, transport: http(), account }); await w.predictEntityKeys({ owner: account.address, count: 2 })`.

**What would fix it:** add `predictEntityKeys` and `getEntityNonce` to the wallet decorator (it is the client that
knows the owner), or correct the wallet client's docstring. **Workaround:** predict with a public client.

## 4. `ExpiryExtended` does not say who extended

**Filed upstream:** [arkiv-sdk-js#127](https://github.com/Arkiv-Network/arkiv-sdk-js/issues/127)

**Surface:** `watchEntityEvents` / `ExpiryExtendedEvent`.

**Expected:** with `permissionlessExtension`, "who kept this alive" is the interesting fact, and the event would carry it.

**Actual:** the event carries the entity's **owner**, not the extender (the type's own docs say so). To show "Last tended
by" on a lighthouse we call `getTransaction(event.transactionHash)` and read `from` for every extension event: one extra
RPC per event.

**What would fix it:** include the sender (`extendedBy`) in `ExpiryExtended`, at least for permissionless entities.

## 5. The faucet only pays the wallet you sign in with

**Surface:** Hub faucet (`hub.arkiv.network/faucet`).

**Expected:** fund an app's server wallet (our treasury, a fresh key that never touches a browser) directly.

**Actual:** the faucet claims to the connected wallet only, one claim per wallet per cooldown. We had to claim to a
personal wallet and send the GLM on to the treasury in a second transaction (10 GLM arrived at `0x1518…70f9`).

**What would fix it:** an optional "send to" address on the claim, still rate-limited per signed-in wallet.

## 6. Small doc snags

- The SDK README (0.8.1 on npm) shows the install step producing `"@arkiv-network/sdk": "^0.6.0"` in `package.json`,
  and its write example suggests a shared public private key "for quick testing". Both are stale or risky for new builders.
- Expiry produces no event (by design). A client that wants a "just sank" moment has to compare each entity's
  `$expiresAt` with the head block itself. We do this every 10 s locally; a note in the events docs would save the search.


## 7. `readonly` doesn't freeze the expiry (Puffer Pass, 16 Oct)

**Surface:** creation flags.

**Expected:** a `readonly` entity is fully immutable, so a game timer stored as its expiry can't be tampered with.

**Actual:** the type docs are precise about it: readonly means attributes and payload can't change, but the owner can
still extend the expiry, transfer it and delete it. In Puffer Pass the holder of the puffer is its owner, so the holder
could push the fuse out. **Workaround:** the puffer also carries its pop block as a `fuse` attribute (which readonly does
freeze), and the rules judge the pop at `fuse`, ignoring any extension. A flag such as `fixedExpiry` would make the
entity's expiry itself a trustworthy timer.

## 8. Expiry has no event, so "it popped" is computed by every client

**Surface:** `watchEntityEvents`.

**Actual:** the decisive moment of the game (the puffer expiring) emits nothing. Each client estimates the head block
from the last event's `blockNumber` plus wall-clock time, notices `head ≥ fuse`, then re-reads the table to confirm from
the records. It works, but an `EntityExpired` event (or a cheap "expiries in block N" query) would remove the guesswork
and the extra reads.

## 9. Write latency is the game's tension, and it's ~1 block

**Measured (16 Oct, two full 4-player games in the browser):** a pass (`executeBatch` with one create and one
`changeOwnership`) showed up as an `OwnershipTransferred` event on the socket in about one to two blocks; the receipt
promise resolved a few seconds later. We drive the UI from the event, not the receipt. A pass that reaches the node after
the fuse block fails as expected ("entity not found"), and the player sees "too late: it popped in your hands".

## 10. `next()` goes stale after one block unless you pin the query yourself (18 Oct)

**Filed upstream:** [arkiv-sdk-js#125](https://github.com/Arkiv-Network/arkiv-sdk-js/issues/125)

**Surface:** `arkiv_query` pagination (`QueryResult.next()`, `SelectQueryBuilder.atBlock()`), `@arkiv-network/sdk` 0.8.1.

**Expected:** the `cursor()` JSDoc says "Pagination normally goes through `QueryResult.next`, which carries the cursor
for you", so walking a 2-page result with `next()` should just work.

**Actual:** a cursor is bound to the block it was issued at (the same JSDoc says so, further down), and Tiramisu makes a
block every 2 s. Any `next()` that runs after a new block fails with `QueryError: Query rejected (cursor, -32005):
Request exceeds defined limit.` and `data.message` = *"cursor belongs to a different query, block or select — start a
new page-through"*. Our item 2b workaround (retry the same `next()`) could never succeed. From a fresh browser the
stale page was also **held ~10 s** before the rejection, so the game's first screen waited 15+ s. The page already
carries its `blockNumber`, but `next()` doesn't pin to it.

**Steps to reproduce** (measured 18 Oct on our 316-entity world query, 2 pages):
```js
const p = await client.select().where(eq("app", "tideland")).limit(200).fetch()
await new Promise((r) => setTimeout(r, 2500))
await p.next() // rejected; 3 of 3 runs (immediately: 3 of 3 succeed)
```
Pinned, the same wait is fine (3 of 3): `client.select().where(...).atBlock(p.blockNumber).limit(200).fetch()` → wait 5 s
→ `next()` succeeds.

**What would fix it:** have `QueryResult.next()` send `atBlock: this.blockNumber` automatically (it has it), or make
`fetch()` pin by default when it returns a cursor. Until then, say in the pagination docs that walks longer than one
block need `.atBlock()`, and give this case its own `QueryError` kind instead of the generic `-32005`.
**What we changed:** [`collect()`](../shared/tideland.js) re-runs any read that needs a second page pinned to the first
page's block, and starts over on a stale cursor or a read that hangs past 8 s.

---

## Tested paths that worked as documented

| What we did | Result |
|---|---|
| `executeBatch` creating a parcel **and** a structure that references the parcel's key, using `predictEntityKeys` + per-create `salt` | Worked first try. Minted keys matched the prediction. 231,568 gas (~0.00023 GLM). |
| Single `createEntity` (guild charter) | 101,600 gas (~0.0001 GLM). |
| `extendEntity` by a **non-owner** on an entity created with `permissionlessExtension` | Lighthouse expiry moved from block 741,782 to 742,116; owner unchanged. |
| `executeBatch` with two `extensions` (house + land) | Both expiries moved in one tx (914,872 → 914,895 and 1,217,272 → 1,217,295). |
| `executeBatch` with two `ownershipChanges` | `$owner` changed on both; `$creator` unchanged, so "built by" survives the sale. |
| `readonly` flag on monuments and inscriptions | Created fine; the UI offers no edit. |
| `changeOwnership` of a `readonly` puffer, repeatedly, each in a batch with a `readonly` create | Worked on every pass across two 4-player games; `$creator` of the puffer stays the server. |
| `ExpirationTime.atBlock(fuse)` on create | The entity left queries at exactly that block; passes after it reverted. |
| Paying a winner with `extensions: [home → atBlock(target)]` signed by the loser | Their house went from 13 h 52 m to 21 h 51 m (+8 h pot) in the same tx as the `win` record. |
| Range query on the system attribute `$expiresAt` (the tide map) | Returns exactly the entities sinking before the given block. |
| Range queries on `i32` attributes `x`, `y` (region / single cell) | Work as documented. |
| `watchEntityEvents` over `webSocket()` with no `fromBlock` | Events arrived in the browser and drove the UI without polling. |
| Read-after-write | Receipts took ~6.3 s (≈3 blocks); `arkiv_query` reflected the change **~300 ms after the receipt** (3 runs: 267, 370, 309 ms). |
| `$createdAt` returned in results but not filterable | As documented; our claim rule sorts by it client-side. |
