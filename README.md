# Tideland

**Islanders who need food, sleep and friends, in houses the tide is taking back.** Every need is an Arkiv entity with
a lifetime: a meal feeds for 8 hours, sleep rests for 12, a friend's visit warms for 24, and the house can hold 3 days
at most. You can fish and sleep for your islander; only *other people* can visit, cook for them, or keep the house
afloat. A friend's visit is one atomic transaction that creates the visit, cooks a meal and hands it over (the cook stays
`$creator`, your islander's owner becomes `$owner`), and shores up the house.

**Your house sinks unless someone keeps it afloat.** Build a house on the coast; it starts with 12 hours and can never
hold more than 3 days, and only *other people* can keep it alive. Share the link; a friend opens it, holds a button,
and watches the water drain. Releasing seals one atomic Arkiv transaction that extends your house **and** writes their
signed line in its guestbook. Your house lives exactly as long as somebody cares.

**A shared world the tide is always taking back.** Every house, parcel, inscription and guild charter on this coast is an
[Arkiv](https://arkiv.network) entity with an expiry. Nothing deletes them. When nobody tends something, its expiry passes and it
drops out of every query: it sinks. Decay is not game code a studio can patch. It is the database.

- **Play:** https://tideland.nerom.site: **Build your house**, or **Save a sinking house**. Share links look like `https://tideland.nerom.site/h/<house key>` and unfurl on X as a playable card.
- **Keeper Run:** 90 seconds in a storm. Buoys, jetties, sea walls and lighthouses are *commons*: created with
  `permissionlessExtension`, owned by nobody's upkeep. Run between them and hold to patch before they sink. Every patch
  is a real Lifetime Extension, sealed every few seconds in one atomic batch from your own key. Your run becomes a
  read-only entity that is remembered longer the better you played.
- **Data contract:** [`arkiv/schema.md`](arkiv/schema.md) · **Friction report:** [`arkiv/friction.md`](arkiv/friction.md)
- **Network:** Arkiv Tiramisu testnet (chain `7738577`), `@arkiv-network/sdk` 0.8.1
- **Tracks:** Censorship Resistance · Open Source
- Built for *Arkiv: Global Tour Stop* (9–18 Oct 2026). Tideland won 1st place in the Arkiv Ideathon (Aug 2026) as an idea and data model; this repo is the first real build.

## Why it needs Arkiv

| If Tideland ran on… | What breaks |
|---|---|
| Postgres + a game server | Decay is a cron job and a promise. One patch, one admin, one shutdown and the world is gone or rewritten. |
| IPFS | Pinning has no expiry you can query, and nothing tells every client the same thing about what is still standing. |
| A subgraph | It indexes a contract; someone still has to run it, and the world's rules would live in our contract and our indexer. |
| Our own API | We become the single point of takedown. The world dies the day we stop paying for it. |

On Arkiv, a house's lifetime is the entity's expiry, enforced by the network; the builder is `$creator`, which nobody can
rewrite; and the whole world is a public query anyone can run. There is **no Tideland server**: the web client reads Arkiv
directly, and [`cli/tide.mjs`](cli/tide.mjs) is a second client that draws the same coast in a terminal.

**Deliberately kept off Arkiv:** sprites and animation (they ship with each client), realtime movement, and any personal data.
The only server code is [`api/drip.js`](api/drip.js), which sends new players a little *test* GLM so they can sign their own
writes, and [`api/rpc.js`](api/rpc.js), a read-only relay the client uses only if a visitor's anonymous RPC budget runs out.

## How each Arkiv feature is used

| Feature | What the player sees | Code |
|---|---|---|
| **Presence as a lease** | Your islander's position is a 10-minute entity, patched and extended in one batch when you stop walking; close the tab and you fade from the square. | [`movePresence()`](shared/tideland.js), [`walk.js`](web/src/walk.js) |
| **60-second speech** | Chat bubbles are entities that live one minute: the conversation literally evaporates. | [`say()`](shared/tideland.js) |
| **The live layer is a range query** | While walking, socket events re-read only `$expiresAt < now + 1 h`, which is exactly the presence and speech. | [`nowQuery`](shared/tideland.js) |
| **Needs as lifetimes** | Food 8 h, rest 12 h, friends 24 h, home 3 d: the islander's mood, pose and need bars are just which entities are still alive. | [`needsOf()`](shared/tideland.js) |
| **Batch: create + transfer in one tx** | A visitor cooks a meal and hands it over: the meal's key is predicted, created, and `changeOwnership`-ed to your islander in the same batch. | [`visit()`](shared/tideland.js) |
| **`patchEntity`** | Older homes were patched in place to gain an islander; homes are deliberately not `readonly`. | [`scripts/bots.mjs`](scripts/bots.mjs) |
| **Homes: `permissionlessExtension` + a 3-day cap** | Your house can only be kept alive by others; the water line on the house page is its real remaining life. | [`buildHome()`](shared/tideland.js), [`house.js`](web/src/house.js) |
| **Batch: extension + create, atomic** | Holding "keep it afloat" seals the extension and the guestbook record together; a lost race reverts both and is retried on top. | [`tendHome()` / `keepAfloat()`](shared/tideland.js) |
| **`$creator` as social proof** | "Kept afloat by" lists the real signers of tend records; nobody can forge a friend's save. | [`tendsQuery`](shared/tideland.js) |
| **Entity Expiration per type** | Material is lifetime: driftwood 6 h, pine 7 d, stone 90 d, monument 5 y, lighthouse 3 d. Houses weather, flood and sink as their expiry nears. | [`MATERIALS`](shared/tideland.js) |
| **Lifetime Extension** | "Renew" buys the full span again from now. Upkeep is the core loop. | [`renew()`](shared/tideland.js) |
| **Creation flag: `permissionlessExtension`** | The whole Keeper Run: buoys, jetties, sea walls and lighthouses are commons anyone can patch without owning them. The inspector shows who tended one last. | [`sealPatches()`](shared/tideland.js), [`run.js`](web/src/run.js) |
| **Batch of extensions, absolute targets** | A run seals its patches every few seconds as one `executeBatch` of `ExpirationTime.atBlock(...)` extensions: all or nothing. | [`sealPatches()`](shared/tideland.js) |
| **Lifetime as a score** | A finished run is a read-only entity whose lifetime is 12 s per point: the leaderboard decays like the coast. | [`recordRun()`](shared/tideland.js) |
| **Creation flag: `readonly`** | Monuments and inscriptions can never be edited, only allowed to fade. | [`MATERIALS.monument`](shared/tideland.js), [`inscribe()`](shared/tideland.js) |
| **`$creator` vs `$owner`** | "Built by" (forever) vs "Held by" (land can be handed on). Click any address for its legacy (`createdBy`) and estate (`ownedBy`). | [`legacyQuery`/`estateQuery`](shared/tideland.js) |
| **Batch + predicted keys** | Claiming land and building on it is one atomic transaction. The house references its parcel's key before that key exists. | [`claimAndBuild()`](shared/tideland.js) |
| **Range queries on numeric attributes** | `x`/`y` are `i32`, so drawing a region is a range query. | [`worldQuery()`](shared/tideland.js) |
| **Query on `$expiresAt`** | The tide map, "what sinks in the next day", is one range query on the system expiry. | [`tideQuery()`](shared/tideland.js) |
| **WebSocket entity events** | Builds, renewals and transfers appear on every open screen without a refresh. | [`watchLive()`](web/src/main.js) |
| **Cursor pagination** | Every query walks all pages (`hasNextPage`/`next`). | [`collect()`](shared/tideland.js) |

## Reproduce it

**1. Read the world without our site** (no wallet needed):

```bash
git clone https://github.com/neromtoobad/tideland && cd tideland && npm install
node cli/tide.mjs map          # the coast, drawn from Arkiv
node cli/tide.mjs tide 24      # the tide map: what sinks within 24 h
node cli/tide.mjs guilds       # charters and their standing footprint
```

The exact query behind the tide map:

```
app = str('tideland') AND world = str('s1') AND $expiresAt < u64(<head + 43200>)
```

**2. Play a Keeper Run:** open https://tideland.nerom.site and press **Start a storm shift**, pick a keeper, start.
Your browser makes a local test key and tops it up with test GLM automatically. Click a commons with a red ring to run
there and hold to patch. Watch the HUD's batch counter and "last tx" link: each one is an `executeBatch` on Tiramisu.

**3. Build:** press **Play with a local key**, then **Get test GLM**. Click an open cell, name it,
pick a material and **Claim this cell**: a parcel and a house are created in one batch. Find a lighthouse you don't own and
**Tend the light**. Click any address to see what it built and what it holds.

**4. Run the web client locally:** `npm run dev` → http://localhost:5174

## On-chain evidence (Tiramisu)

Wallets that create Tideland entities:

| Role | Address |
|---|---|
| Treasury (funds players' test GLM, never writes entities) | `0x15182825237e9E13F4822B7eb92eDf15E95470f9` |
| Tidewrights founder / villagers | `0x498307005DEe719Fb85Cb9A891bae8242d89c172` · `0x79F2A53cC10eBf38Bc3E889a0E8a2B1F3f5860F4` · `0x9C8f66a029e86e84A134EC0481F9eDDcf9806e20` |
| Granite Hands founder / villagers | `0xD321C6F69862Bb9273Ec55AfDD93Df43dEDA3157` · `0x1180F5ed4E3B5BbBbAeb1F67e34EC4C60c92c70B` · `0x455bDa4E6a28342763946f3688204a44Be1EE4BC` |
| Lamplighters founder / villagers | `0x6f5cB8FC63047Bce8Cc6C8c0ab0B2B0651BB3648` · `0x6B4744C8f41245072cA0DF98d32c34c36a2485bc` · `0x9b667162F892Cc7A7113CD00f736D03819982BED` |
| Harbour Trust (places the commons, never maintains them) | `0x643A28f7E81f398EC0a8Bc7460aAE1abc9A1721E` |
| Players | any address: each player signs with their own key |

Sample transactions (explorer):
- First entity, the Tidewrights charter: [`0x3d1dd5ff…`](https://tiramisu.explorer.arkiv.network/tx/0x3d1dd5ff68f957c22762663d75bb8352017d1dacd82135d83ee9b1044ebb0c2d)
- Claim + build in one batch (parcel and pine house, house references the predicted parcel key): [`0x3dc2cdaa…`](https://tiramisu.explorer.arkiv.network/tx/0x3dc2cdaabcf0a9da0953790fc58177dbb68c0258c2c4b665aba3ac7357b74d9b)
- Bots playing in public CI: [guilds workflow runs](https://github.com/neromtoobad/tideland/actions/workflows/bots.yml)

The guild bots are ordinary players with their own wallets. They run every 20 minutes in public CI
([`.github/workflows/bots.yml`](.github/workflows/bots.yml), [`scripts/bots.mjs`](scripts/bots.mjs)): they renew most of
their houses, forget some, keep every lighthouse lit, and leave the Driftwood Flats to the tide.

## Repo map

```
arkiv/schema.md      the data contract (entity types, attributes, lifetimes, queries)
arkiv/friction.md    what got in the way, with versions and repro steps
shared/tideland.js   the contract in code, shared by every client
web/                 the web client (Vite, canvas, no framework)
cli/tide.mjs         a second, independent client
scripts/bots.mjs     the founding guilds
api/                 drip (test GLM) and read-only relay; no world logic
art/contact.png      the sprite sheet (Higgsfield renders, processed by scripts/art.mjs)
```

## Pre-existing work

The idea, the five entity types and the material-lifetime table come from the Tideland Ideathon entry (concept page,
August 2026: https://tideland-arkiv.vercel.app, no code). Everything in this repository, including the Arkiv integration,
the client, the CLI and the bots, was written from 15 October 2026. Sprites were generated for this build with Higgsfield.

MIT licensed. All on-chain content is synthetic.
