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
| `kind` | `str` | `table` · `seat` · `puffer` · `pass` · `pop` · `win` · `home` · `meal` · `sleep` · `visit` · `sign` · `presence` · `say` · `tend` · `parcel` · `structure` · `inscription` · `guild` · `run` | Type filter |

Coordinates are **numbers** so regions are range queries: `x` and `y` are `i32` in `0..31`.

## Puffer Pass: hot potato with your house as the stake

The main game. A table seats 2 to 6 islanders, each staking **2 hours of their house**. A pufferfish is served to one of
them. **The puffer is an entity whose expiry is the fuse**, and its holder is its `$owner`. Passing it is a
`changeOwnership`. When the expiry passes, the puffer drops out of every query: it popped, and whoever owned it is out.
No server and no referee contract decide; the network's expiry does.

| Entity | Attributes | Payload | Lifetime | Flags | Written by |
|---|---|---|---|---|---|
| `table` | `ante i32` (minutes staked per seat, 120), `seats i32` (max 6) | `{ name }` | 30 min | none | the host, in one batch with their own `seat` |
| `seat` | `table key`, `home key`, `look str` | `{ name }` | 1 day | `readonly` | each player; `$creator` is the player |
| `puffer` | `table key`, `round i32`, `fuse u64` (the pop block) | `{}` | **until `fuse`** (`ExpirationTime.atBlock`) | `readonly` | the server, in one batch with the first `pass` and the hand-over |
| `pass` | `table key`, `puffer key`, `round i32`, `to addr`, and on the serve only `fuse u64` | `{}` | 1 day | `readonly` | the holder, in one batch with `changeOwnership(puffer → to)` |
| `pop` | `table key`, `round i32`, `puffer key`, `home key` (the loser's house), `loser addr` | `{}` | **6 h: the flood** | `readonly` | the loser first; any seated witness after 7 s; the crew for bots |
| `win` | `table key`, `home key` (the winner's house), `minutes i32` (paid), `pot i32` | `{}` | 30 days | `readonly` | whoever writes the final pop, in the same batch as the payout |

**Serve** (one batch): create the puffer (key predicted with `predictEntityKeys`) with an exact expiry block, create the
first `pass` record carrying the same `fuse`, and `changeOwnership` the puffer to its first holder. Fuses are 20 to 36 s.

**Pass** (one batch): create a `pass` record and `changeOwnership` the puffer to the target. Both land or neither. A
pass that arrives after the fuse fails (the entity is gone), so a slow throw pops in your own hands.

**The rules every client applies** ([`resolveTable()`](../shared/tideland.js), a pure function of the table's records):

1. Seats: one per player, the first 6 by `$createdAt`, taken before the first serve. Pot = seats × `ante`.
2. Round *r*'s puffer is the earliest serve for round *r* by a seated player to a live seat.
3. The holder at the pop is found by following that puffer's `pass` records in order: a pass only counts if its
   `$creator` was the holder at the time and its `to` is a seat. Passes at or after `fuse` don't exist (the engine
   refuses them). Clients also refuse to pass straight back to whoever threw it to you, unless two are left.
4. The `fuse` attribute is the referee, not the live expiry. A `readonly` entity can still be **extended by its owner**,
   so a holder could try to push the fuse out; any extension of a puffer is ignored, and the pop is judged at `fuse`.
5. The loser serves the next puffer (and picks who gets it). If they don't within ~12 s, any seated player may.
6. When one seat is left, the final pop's batch also **extends the winner's house** by the pot (to an absolute block,
   capped at the house's level limit; homes are `permissionlessExtension`, so anyone can pay it) and writes the `win`.
   A duplicate payout would not move the expiry later, so the engine reverts it.

**The stake is real, in both directions.** Arkiv can never shorten an entity, so a pop can't take hours off a house.
Instead the `pop` entity points at the loser's house and lives 6 hours: **while it is alive the house is flooded**,
and no Tideland client (web, CLI or the guild bots) will shore that house up. Its lifetime is the flood. The winner's
gain is a real `extendEntity` on their house, signed in the same transaction as the `win` record.

**Reading a table:** `app = 'tideland' AND world = 's1' AND table = <key>` returns seats, passes, pops, wins and the live
puffer in one query. Live play rides on `watchEntityEvents`: an `OwnershipTransferred` on the current puffer is a pass
and is applied without a re-read; any other create triggers one debounced query.

**The crew.** The nine guild bots can take seats ([`/api/crew`](../api/crew.js)). Each signs with its own key and stakes
its own house. The browser at the table decides when a bot moves; the endpoint only signs, and a bot can only pass a
puffer it owns.

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

### Islanders: needs are entities

Each home has an islander (`look` attribute: `carpenter` · `mason` · `lamplighter`; payload `islander` name). Their
needs are entities that point at the home with a `home key` attribute. **Each need's lifetime is the need's decay.**

| Need | Entity `kind` | Lifetime | Who creates it | Owner |
|---|---|---|---|---|
| Food | `meal` (attrs `home key`, `dish str`) | **8 h** | the islander's owner (fishing) or **any visitor** (cooking) | the islander's owner: a cooked meal is handed over with `changeOwnership` in the same batch, so the **cook stays `$creator`** |
| Rest | `sleep` (attr `home key`) | **12 h** | the owner | the owner |
| Friends | `visit` (attr `home key`, payload `note`) | **24 h** | visitors only (the owner's own visits don't count) | the visitor |
| Home | the `home` itself | ≤ **3 days** | anyone can extend it (`permissionlessExtension`) | the owner |

All need entities are `readonly`. Mood and pose are derived on the client from which needs are alive: sleeping (first
hour of a sleep), eating (first 15 min of a meal), waving (visit in the last 30 min), sad (house under 6 h, or no
friends), hungry, sleepy, happy. The diary is written from the same entities.

**A visit is one atomic batch of up to five operations:** create the `visit`; create a `meal` (its key predicted with
`predictEntityKeys`, so the same batch can transfer it); extend the `home` to an absolute block; create the `tend`
record; and `changeOwnership` of the meal to the islander's owner. Creates lead a batch and ownership changes come last,
which is what makes the hand-over possible in one transaction.

Homes built before islanders existed were **patched in place** (`patchEntity` setting `look` and the islander's name):
homes are deliberately not `readonly`.

### The goal: signatures and house levels

Every visit's batch also creates a **`sign`** (attrs `home key`; payload `note`; **30 days**; `readonly`): a line in the
house's book whose `$creator` is the visitor. Distinct signers (never the owner) earn levels, and each level holds longer:

| Level (`style`) | Signers needed | The house can hold |
|---|---|---|
| `driftwood` (Driftwood shack, everyone starts here) | 0 | 2 days |
| `pine` (Pine cottage) | 3 | 3 days |
| `stone` (Stone house) | 6 | 5 days |
| `lighthouse` (Lighthouse home) | 10 | 7 days |

Upgrading is a **`patchEntity`** that sets the home's `style`. The engine doesn't know the rule, so any client checks
the claim: earned level = f(number of distinct `sign` creators for that home); a home that claims more than it earned is
shown as **unverified**. Signatures expire after 30 days, so a house has to stay loved to stay big.

The island board is two queries over live entities: most loved (distinct signers per home) and longest afloat
(`head − $createdAt` of each live home).

### The live layer: `presence` and `say`

| | `presence` (where an islander is standing) | `say` (something they said) |
|---|---|---|
| Attributes | `home key`, `x i32`, `y i32`, `look str` | `home key`, `x i32`, `y i32` |
| Payload | `{ "name": "Pip" }` | `{ "text": "Anyone got fish?" }` (max 90 chars) |
| Lifetime | **10 minutes** (players), 25 minutes (villager bots) | **60 seconds** |
| Flags | none: it is patched as you move | `readonly` |
| Written | when you arrive somewhere: **one batch** of `patches` (x, y) + `extensions` (another 10 minutes) | when you press Say |

Walking itself is local; only where you *stop* is written. If you close the tab, your presence simply expires and your
islander is gone from the square. Speech bubbles are drawn for exactly as long as their entity lives.

While you walk, live socket events trigger one cheap query instead of a full re-read:
`app = 'tideland' AND world = 's1' AND $expiresAt < u64(NOW + 1800)`. Everything short-lived (presence, speech,
whatever is about to sink) is by definition in it.

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

### `bottle` — a message nobody can take down

| | |
|---|---|
| Attributes | `app`, `world`, `kind="bottle"`, `bx i32`, `by i32` (a spot in the sea, outside the 32×32 land grid, so the land layout never sees it) |
| Payload (JSON) | `{ "text": "...", "from": "..." }` (text max 140 chars, `from` optional; synthetic content only) |
| Lifetime | **1 day** to start; every keep adds **6 h**, never more than **7 days** ahead |
| Flags | `readonly` **and** `permissionlessExtension` |
| `$creator` | whoever threw it |
| `$owner` | **`0x000000000000000000000000000000000000dEaD`**, set by `changeOwnership` in the same `executeBatch` that creates it |

Why it can't be taken down: `readonly` means no one can edit the words, and only an entity's owner can delete it. The
owner is a burn address no one has a key for, so no one (the writer, Tideland, anyone) can delete a bottle. Its fate is
only its lifetime, and `permissionlessExtension` puts that in the hands of whoever reads it. Measured 18 Oct: the
thrower's own `deleteEntity` was refused with *"entity … is owned by 0x…dEaD"*.

### `keep` — one stranger keeping a bottle afloat

| | |
|---|---|
| Attributes | `app`, `world`, `kind="keep"`, `bottle key`, `minutes i32` (life added) |
| Payload (JSON) | `{ "note": "..." }` (max 80 chars) |
| Lifetime | 30 days |
| Flags | `readonly` |
| Written | in **one batch** with the bottle's extension (`extensions: [bottle → atBlock(target)]` + this create) |
| `$creator` | the keeper: "kept afloat by" is a list of real signers |

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
| Everything about one islander (needs, visits, saves) | `app = 'tideland' AND world = 's1' AND home = key(<home>)`: one query, 100 units |
| A house's guestbook | `app = 'tideland' AND world = 's1' AND kind = 'tend' AND home = key(<home>)` |
| Everyone a player has saved | `kind = 'tend'` + `createdBy(address)` |
| Houses sinking now ("Save a sinking house") | `kind = 'home'`, sorted by `$expiresAt` client-side; also in the tide map query |
| Messages in bottles | `app = 'tideland' AND world = 's1' AND kind = 'bottle'` (owner is always `0x…dEaD`) |
| Who kept a bottle afloat | `app = 'tideland' AND world = 's1' AND kind = 'keep' AND bottle = key(<bottle>)`, distinct `$creator` |
| The season board (30 days) | `kind = 'win'` grouped by `home`; `kind = 'tend'` and `kind = 'keep'` grouped by `$creator` (client-side, from the world read) |
| **Rewind the tide:** the island N hours ago | the world query with `atBlock: NOW − N × 1800`; diffed against now for "lost to the tide" and "new since" |
| Keepers remembered (leaderboard) | `app = 'tideland' AND world = 's1' AND kind = 'run'`, sorted by `score` client-side (no server ordering) |

Every query is paged with the SDK cursor (`hasNextPage()` / `next()`, max 200 per page), and a read that needs more
than one page is pinned to its first page's block (`atBlock`), because a cursor goes stale after one 2-second block. There is no server-side
ordering, so clients sort by `$createdAt` / `$expiresAt` locally.

## Live updates

The client subscribes with `watchEntityEvents` over a **WebSocket** transport and no `fromBlock`, so events arrive on a
socket instead of a polling loop. `EntityCreated` / `ExpiryExtended` / `OwnershipTransferred` / `EntityDeleted` update
the map in place. Expiry emits no event: a client notices a sinking entity by its `$expiresAt` passing the head block.

## Wallets that write Tideland entities

See the README section "On-chain evidence" for the current list (treasury, seeded founding guilds, players).
