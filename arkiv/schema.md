# Tideland data contract (`/arkiv/schema.md`)

Tideland is a shared world that lives entirely in Arkiv entities on the **Tiramisu testnet** (chain `7738577`).
There is no game server and no database of ours. Any client, mod, map site or bot that follows this document
draws the same world. Our web client is one implementation; [`cli/tide.mjs`](../cli/tide.mjs) is a second one.

- SDK: `@arkiv-network/sdk` 0.8.1
- RPC: `https://rpc.tiramisu.db-chain.testnet.arkiv.network` · WS: `wss://rpc.tiramisu.db-chain.testnet.arkiv.network`
- Block time: 2 s. Every lifetime below is converted to blocks by the SDK (`ExpirationTime.fromDays(7)` = 302,400 blocks).

## Common attributes (on every Tideland entity)

| Attribute | Type | Value | Why it is an attribute |
|---|---|---|---|
| `app` | `str` | `"tideland"` | Namespace filter, every query starts with it |
| `world` | `str` | `"s1"` (season) | A new season is a new world without touching old data |
| `kind` | `str` | `home` · `tend` · `parcel` · `structure` · `inscription` · `guild` · `run` | Type filter |

Coordinates are **numbers** so regions are range queries: `x` and `y` are `i32` in `0..31`.

## Entity types

### `home` — your house (the heart of the game)

| | |
|---|---|
| Attributes | `app`, `world`, `kind="home"`, `x i32`, `y i32`, `style str` (`pine` · `stone` · `driftwood`) |
| Payload (JSON) | `{ "name": "Saltbreak Cottage" }` (players are asked not to use real names) |
| Lifetime | starts at **12 hours**; can never hold more than **3 days** from now |
| Flags | `permissionlessExtension`: anyone can keep it afloat; nobody else can change it |
| `$creator` / `$owner` | the builder |

The client never lets you tend your own home: only other people can keep it alive, so a home lives exactly as long
as somebody cares about it.

### `tend` — one save, a line in the guestbook

| | |
|---|---|
| Attributes | `app`, `world`, `kind="tend"`, `home key` (the home), `minutes i32` (life bought) |
| Payload (JSON) | `{ "note": "Held the line for you!" }` (max 80 chars, optional) |
| Lifetime | 30 days |
| Flags | `readonly` |
| `$creator` | the person who saved it: "kept afloat by" is a list of verifiable authors |

**A save is one atomic batch:** `executeBatch({ extensions: [home → atBlock(target)], creates: [tend] })`. If
somebody else extended the home first, our target would shorten its life, the engine reverts the whole batch (no false
guestbook line), and the client re-reads the home's expiry and stacks the save on top, once.

### `parcel` — a land claim

| | |
|---|---|
| Attributes | `app`, `world`, `kind="parcel"`, `x i32`, `y i32`, `guild key` (optional, the guild entity key) |
| Payload (JSON) | `{ "name": "Driftwood Rest" }` |
| Lifetime | **14 days**, renewed by its owner (Lifetime Extension). |
| Flags | none. Only the owner can renew it. |
| `$creator` | the founder, forever |
| `$owner` | the holder; land is sold by `changeOwnership` |

**Claim rule (every client applies it the same way):** a cell belongs to the live `parcel` at that `x,y` with the
lowest `$createdAt`; ties break on the lower `$key`. A later claim on a held cell is visible as a contest, and goes
unrenewed by convention. A cell is claimable again only when every parcel on it has expired.

### `structure` — something built on a parcel. **Material is lifetime.**

| Material | Lifetime | Creation flags | Who can extend |
|---|---|---|---|
| `pine` | 7 days | none | owner |
| `stone` | 90 days | none | owner |
| `monument` | 5 years | `readonly` | owner (its words can never be edited) |
| `lighthouse` | 3 days | `permissionlessExtension` | **anyone** (a commons the whole coast keeps lit) |
| `driftwood` | 6 hours | none | owner |
| `buoy` | 2 hours | `permissionlessExtension` | **anyone** (harbour commons) |
| `jetty` | 12 hours | `permissionlessExtension` | **anyone** |
| `seawall` | 1 day | `permissionlessExtension` | **anyone** |

The lifetime is the **most** a structure can hold: a build or renewal buys the full span from now, and a patch can
never push a commons past its full span from now. The Harbour Trust bot sets commons adrift already worn (15–100%
of their span), with no `parcel` attribute; commons stand on open coast and are never owned by anyone who maintains them.

| | |
|---|---|
| Attributes | `app`, `world`, `kind="structure"`, `x i32`, `y i32`, `material str`, `parcel key`, `guild key` (optional) |
| Payload (JSON) | `{ "name": "Old Mill", "note": "..." }` |
| `$creator` | the builder. It survives every sale of the parcel: every ruin has an author. |

Renewing a structure sets its expiry to "material lifetime from now" (the engine rejects an extension that would not
move the expiry later). The client renews the structure and its parcel **in one batch**, so a house is never kept
alive on land that has lapsed.

### `inscription` — words on the land

| | |
|---|---|
| Attributes | `app`, `world`, `kind="inscription"`, `x i32`, `y i32` |
| Payload (JSON) | `{ "text": "..." }` (max 140 chars, synthetic content only) |
| Lifetime | chosen by the writer: 1 day, 1 week, 1 month or 1 year. You pay for exactly how long you want to be remembered. |
| Flags | `readonly`: an inscription can never be edited, only allowed to fade. |

### `run` — one Keeper Run (a 90-second storm shift)

| | |
|---|---|
| Attributes | `app`, `world`, `kind="run"`, `score i32`, `saved i32` (minutes of life sealed), `patches i32`, `keeper str` |
| Payload (JSON) | `{ "batches": 3, "maxCombo": 6, "txs": ["0x…"] }`: the patch transactions, so a run can be audited |
| Lifetime | **12 s per point**, between 1 hour and 30 days. Better runs are remembered longer: the leaderboard decays too. |
| Flags | `readonly` |
| `$creator` | the keeper. The board names keepers by their address. |

**Patching (what a run writes).** Each patch tick buys a commons 2.5% of its span. Patches are applied on screen at
once and sealed every ~2.5 s as **one `executeBatch` of `extensions`**, each with an absolute
`ExpirationTime.atBlock(target)`. Targets are computed from the freshest known expiry, which the client keeps current
from `ExpiryExtended` events (they carry the new `expiresAt`), so a batch only ever moves expiries later.

### `guild` — a charter

| | |
|---|---|
| Attributes | `app`, `world`, `kind="guild"`, `name str` |
| Payload (JSON) | `{ "name": "Tidewrights", "color": "#1F6E68", "motto": "..." }` |
| Lifetime | **30 days**, renewed by the founder. A charter nobody renews disbands the guild by protocol. |
| Membership | a parcel or structure joins by carrying the guild's key in its `guild` attribute. |

## What stays off Arkiv, on purpose

- **Realtime play.** Cursor movement and animation stay in the client. Only durable world changes become entities.
- **Art.** Sprites ship with each client. Entities carry the material name, never image bytes.
- **Keys.** Player keys live in the player's browser (or their own wallet). Nothing secret, and no personal data, is ever written.
- **Execution.** The tide is a query, not a trigger. No cron deletes anything: an entity sinks because its expiry passed.

## Queries the client runs

All expressed with the SDK query builder (`@arkiv-network/sdk/query`). `NOW` is `getBlockTiming().currentBlock`.

| Question | Query |
|---|---|
| Draw a region (viewport) | `app = 'tideland' AND world = 's1' AND x >= i32(x0) AND x <= i32(x1) AND y >= i32(y0) AND y <= i32(y1)` |
| **The tide map:** everything that sinks within a day | `app = 'tideland' AND world = 's1' AND $expiresAt < u64(NOW + 43200)` |
| A builder's legacy (survives sales) | `app = 'tideland' AND kind = 'structure'` + `createdBy(address)` |
| A holder's estate | `app = 'tideland' AND kind = 'parcel'` + `ownedBy(address)` |
| A guild's standing footprint | `app = 'tideland' AND kind = 'structure' AND guild = key(guildKey)` |
| Lighthouses going dark | `app = 'tideland' AND material = 'lighthouse' AND $expiresAt < u64(NOW + 7200)` |
| The commons (run targets) | `app = 'tideland' AND world = 's1' AND kind = 'structure' AND (material = 'lighthouse' OR material = 'buoy' OR material = 'jetty' OR material = 'seawall')` |
| A house's guestbook | `app = 'tideland' AND world = 's1' AND kind = 'tend' AND home = key(<home>)` |
| Everyone a player has saved | `kind = 'tend'` + `createdBy(address)` |
| Houses sinking now ("Save a sinking house") | `kind = 'home'`, sorted by `$expiresAt` client-side; also in the tide map query |
| Keepers remembered (leaderboard) | `app = 'tideland' AND world = 's1' AND kind = 'run'`, sorted by `score` client-side (no server ordering) |

Every query is paged with the SDK cursor (`hasNextPage()` / `next()`, max 200 per page). There is no server-side
ordering, so clients sort by `$createdAt` / `$expiresAt` locally.

## Live updates

The client subscribes with `watchEntityEvents` over a **WebSocket** transport and no `fromBlock`, so events arrive on a
socket instead of a polling loop. `EntityCreated` / `ExpiryExtended` / `OwnershipTransferred` / `EntityDeleted` update
the map in place. Expiry emits no event: a client notices a sinking entity by its `$expiresAt` passing the head block.

## Wallets that write Tideland entities

See the README section "On-chain evidence" for the current list (treasury, seeded founding guilds, players).
