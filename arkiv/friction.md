# Friction report (`/arkiv/friction.md`)

What got in the way while building Tideland, and what worked, with versions and steps to reproduce. Every item below
was hit or measured during this build (15 Oct 2026). Nothing is hypothetical.

**Environment:** `@arkiv-network/sdk` 0.8.1 · `viem` 2.57.7 · Node 24.21.0 (macOS) · Chrome (Claude desktop browser pane) ·
Tiramisu testnet, public RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.

---

## 1. An exhausted anonymous budget looks like a 27-minute hang, not an error

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

## 3. `predictEntityKeys` is not on the wallet client

**Surface:** `createWalletClient` actions.

**Expected:** the wallet client's JSDoc says it offers mutations "on top of the read actions a Public Client has", so
`wallet.predictEntityKeys({ owner, count: 2 })` should work before `wallet.executeBatch(...)`.

**Actual:** `TypeError: wallet.predictEntityKeys is not a function`. It exists only on the public client
(`decorators/arkivPublic.ts`); the example in its own JSDoc uses `client.predictEntityKeys` then `wallet.executeBatch`.

**Steps to reproduce:** `const w = createWalletClient({ chain: tiramisu, transport: http(), account }); await w.predictEntityKeys({ owner: account.address, count: 2 })`.

**What would fix it:** add `predictEntityKeys` and `getEntityNonce` to the wallet decorator (it is the client that
knows the owner), or correct the wallet client's docstring. **Workaround:** predict with a public client.

## 4. `ExpiryExtended` does not say who extended

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
| Range query on the system attribute `$expiresAt` (the tide map) | Returns exactly the entities sinking before the given block. |
| Range queries on `i32` attributes `x`, `y` (region / single cell) | Work as documented. |
| `watchEntityEvents` over `webSocket()` with no `fromBlock` | Events arrived in the browser and drove the UI without polling. |
| Read-after-write | Receipts took ~6.3 s (≈3 blocks); `arkiv_query` reflected the change **~300 ms after the receipt** (3 runs: 267, 370, 309 ms). |
| `$createdAt` returned in results but not filterable | As documented; our claim rule sorts by it client-side. |
