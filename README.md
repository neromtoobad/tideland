# Tideland

**Hot potato with a pufferfish, and your house is the stake.** Sit at a table on the beach, stake two hours of your
house, and pass the puffer before it pops. The puffer is an [Arkiv](https://arkiv.network) entity: **its expiry is the
fuse** and **its holder is its `$owner`**. Every throw is a `changeOwnership` sealed with a signed pass record from
your own key. When the expiry passes, the puffer is simply gone from every query: it popped, and whoever owned it is out.
No server decides. Pop and your house **floods for 6 hours** (nobody can shore it up). The last islander standing takes
the whole pot onto their house, paid in the same transaction as their win record.

Around the game is the rest of Tideland: islanders who need food, sleep and friends, in houses the tide is taking back.
Your house only lives as long as other people keep it afloat, which is exactly why it is worth staking.

- **Play:** https://tideland.nerom.site: **Play Puffer Pass** (the island crew sits with you, or share the table link with friends). Move in first if you have no house; it takes one transaction. Share links look like `https://tideland.nerom.site/h/<house key>` and unfurl on X as a playable card.
- **Keeper Run:** 90 seconds in a storm. Buoys, jetties, sea walls and lighthouses are *commons*: created with
  `permissionlessExtension`, owned by nobody's upkeep. Run between them and hold to patch before they sink. Every patch
  is a real Lifetime Extension, sealed every few seconds in one atomic batch from your own key. Your run becomes a
  read-only entity that is remembered longer the better you played.
- **Data contract:** [`arkiv/schema.md`](arkiv/schema.md) · **Friction report:** [`arkiv/friction.md`](arkiv/friction.md)
- **Network:** Arkiv Tiramisu testnet (chain `7738577`), `@arkiv-network/sdk` 0.8.1
- **Tracks:** Censorship Resistance · Open Source
- **Demo video (2:44):** <!-- VIDEO: paste the YouTube link here --> see the Devfolio submission
- **Read it without us:** [tideland.nerom.site/reader.html](https://tideland.nerom.site/reader.html), one HTML file with no build and no backend. Save it and open it from disk; add `?rpc=<url>` to read through any Arkiv node. Source: [`web/public/reader.html`](web/public/reader.html)
- **Build on it without asking:** [`examples/raw-consumer.mjs`](examples/raw-consumer.mjs), a client in plain JSON-RPC, no SDK, no install; [`examples/keeper.mjs`](examples/keeper.mjs), a stranger's bot that keeps houses afloat with its own key
- **Tests:** `npm test` (the Puffer Pass rules as a pure function, including the cheats every client must ignore)
- Built for *Arkiv: Global Tour Stop* (9–18 Oct 2026). Tideland won 1st place in the Arkiv Ideathon (Aug 2026) as an idea and data model; this repo is the first real build.

## Who is censored today, and what changes (Censorship Resistance)

**The people harmed are players whose worlds live on someone else's server.** When an online-only game's operator
stops paying for it, everything players built is gone, and nobody else is allowed to keep it running:

- Ubisoft switched off the servers of *The Crew* on 31 March 2024. The always-online game has been unplayable since,
  for everyone who bought it ([The Sixth Axis](https://www.thesixthaxis.com/2023/12/14/the-original-the-crew-is-going-offline-in-march-2024/)).
- Fans had to reverse-engineer the servers' answers to bring it back offline. The *The Crew Unlimited* emulator was
  announced for 15 September 2025 ([Checkpoint Gaming](https://checkpointgaming.net/news/2025/09/modders-save-ubisofts-the-crew-with-a-release-date-imminent/)).
- The *Stop Killing Games* European Citizens' Initiative, asking that bought games stay playable after support ends,
  collected **1,294,188 verified signatures** ([Destructoid](https://www.destructoid.com/the-final-count-of-stop-killing-games-verified-signatures-is-in-and-it-proves-that-gamers-can-really-come-together-when-needed/)).

**What changes with Tideland, from day one.** Nothing of the world lives on our side. If we stopped paying for
tideland.nerom.site tonight:
- every house, guestbook signature, win and storm patch can still be read and queried from Arkiv by anyone: with the
  standalone [reader page](web/public/reader.html) (one HTML file: save it, open it from disk, point it at any Arkiv
  RPC with `?rpc=`), [`cli/tide.mjs`](cli/tide.mjs), the [raw consumer](examples/raw-consumer.mjs), or the curl below;
- houses keep living as long as *other players* keep them afloat. Their lifetimes are enforced by the network, and
  `permissionlessExtension` means no one needs our permission (or our keys) to extend them. Proof: a stranger's key with
  nothing from us but this repo ran [`examples/keeper.mjs`](examples/keeper.mjs) and kept Kemi's house afloat:
  [`0xafafed24…`](https://tiramisu.explorer.arkiv.network/tx/0xafafed241a61488ee738b05c05e0e40731922f82d09181851a7a15636f2cb18d);
- anyone can host the web client (`npm run build`, static files), run the bots, or write a new client. The rules are pure
  functions of public records ([`resolveTable()`](shared/tideland.js), with [tests](test/rules.test.mjs)), not server logic.

What Tideland is *not*: proof against Arkiv itself going away (it runs on the Tiramisu testnet). It removes the
**operator** as the point of takedown, which is exactly what killed *The Crew*. See [Limits](#limits-and-who-you-trust).

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
writes, [`api/rpc.js`](api/rpc.js), a read-only relay the client uses only if a visitor's anonymous RPC budget runs out,
and [`api/crew.js`](api/crew.js), which signs for the nine guild bots when they sit at a Puffer Pass table (each bot has
its own key and stakes its own house; the endpoint can't move a puffer a bot doesn't own). The game's rules don't live
there: every client recomputes them from the table's public records.

## How each Arkiv feature is used

| Feature | What the player sees | Code |
|---|---|---|
| **Expiry as a game clock** | The puffer's fuse is its expiry, pinned with `ExpirationTime.atBlock`. It swells as the block approaches; when the block passes, it pops. | [`servePuffer()`](shared/tideland.js), [`puffer.js`](web/src/puffer.js) |
| **`changeOwnership` as a move** | Holding the puffer = owning the entity. A throw is one batch: a signed `pass` record + the ownership change. A throw that lands after the fuse fails. | [`passPuffer()`](shared/tideland.js) |
| **Rules as a pure function of public records** | Seats, the holder chain, who popped and who won are recomputed by every client from one query, so a cheat (passing to a non-player, extending the fuse) is ignored by everyone. | [`resolveTable()`](shared/tideland.js) |
| **A lifetime that is a penalty** | A `pop` entity points at the loser's house and lives 6 h: while it's alive the house is flooded and no client (web, CLI, bots) shores it up. | [`popPuffer()`](shared/tideland.js), [`floodOf()`](shared/tideland.js) |
| **Batch: pop + payout + win, atomic** | The final pop extends the winner's house by the pot (permissionless) and writes their 30-day `win`, together. | [`popPuffer()`](shared/tideland.js) |
| **Live play over the socket** | `OwnershipTransferred` events move the puffer on screen without a re-read; other creates trigger one debounced table query. | [`onEvent()`](web/src/puffer.js) |
| **Verifiable progression** | Visits leave 30-day signatures; distinct signers level a house up (shack → cottage → stone → lighthouse, holding 2 → 7 days). Upgrading is a `patchEntity`; every client checks the claimed level against the signatures' `$creator`s and flags an overclaim. | [`levelBlock()`](web/src/house.js), [`LEVELS`](shared/tideland.js) |
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
| **WebSocket entity events** | Builds, renewals and transfers appear on every open screen without a refresh. A "Live on Arkiv" strip lists Tideland's writes as they land (throws, saves, pops, wins), each with its transaction. | [`watchLive()` / `onFeed()`](web/src/main.js) |
| **Cursor pagination** | Every query walks all pages (`hasNextPage`/`next`). | [`collect()`](shared/tideland.js) |

## On-chain proof: one transaction per feature

Each transaction was decoded op by op (calldata and receipt events), not just looked up. Short-lived records like
puffers, passes and speech have expired, as designed; their transactions stay on the chain.

| Feature | Transaction | What it shows |
|---|---|---|
| Claim + build, predicted keys | [`0x3dc2cdaa…`](https://tiramisu.explorer.arkiv.network/tx/0x3dc2cdaabcf0a9da0953790fc58177dbb68c0258c2c4b665aba3ac7357b74d9b) | 2 creates in one tx: a parcel and a pine house whose `parcel` attribute is the parcel's key, predicted before it existed |
| A friend's visit, one batch | [`0xeb0b1a00…`](https://tiramisu.explorer.arkiv.network/tx/0xeb0b1a008953146834b878211407c1631b19271ba9f45d25bfda1f93c69e4d10) | 6 ops: creates a visit, a meal, a tend and a signature; extends the house; hands the meal to the house's owner (`changeOwnership`) |
| Permissionless extension by a stranger | [`0xafafed24…`](https://tiramisu.explorer.arkiv.network/tx/0xafafed241a61488ee738b05c05e0e40731922f82d09181851a7a15636f2cb18d) | [`examples/keeper.mjs`](examples/keeper.mjs) run from a fresh key: a tend record + an hour more for Kemi's house, which it doesn't own |
| Puffer Pass serve | [`0x95f2d214…`](https://tiramisu.explorer.arkiv.network/tx/0x95f2d21479dd71d9bd249d0a76f52a9d7bc71afe36b41717f6cfb38a7576b7ac) | 3 ops: the puffer, created `readonly` with its expiry pinned to block 656020 (= its `fuse` attribute); the first pass record; the hand-over to the first holder |
| A throw | [`0xa79b2707…`](https://tiramisu.explorer.arkiv.network/tx/0xa79b2707e6f3e82251385f1c24034ccba1797ce93752b16d8a56fde9bf259bbd) | Signed by the holder: a pass record + `changeOwnership` of the puffer to the next player |
| Pop + payout + win | [`0x5e6a7481…`](https://tiramisu.explorer.arkiv.network/tx/0x5e6a7481e022ce97cff1a30cca57cbdae4849403aabc25e357af9c145758c07e) | Signed by the loser: the 6 h `pop` record, a 30-day `win` (pot 480 min), and the extension of the winner's house, all in one tx |
| Storm shift seal | [`0x1e618fec…`](https://tiramisu.explorer.arkiv.network/tx/0x1e618fec6e027ccd0b1125fdf8a5d9420fd7a5c927d65c4bbeb0104172bf7bb3) | One `executeBatch` of 4 `atBlock` extensions (two bells, a buoy, a sea wall) on commons owned by the Harbour Trust, sent from a stranger's key. All or nothing ([`sealPatches()`](shared/tideland.js)) |
| A run remembered by its score | [`0x0fd25669…`](https://tiramisu.explorer.arkiv.network/tx/0x0fd256697655d59cd76331150586283995b17441677c82dc189cba63b957c6fb) | A `readonly` run record whose lifetime (≈22 days) comes from its score; its payload lists its 8 seal transactions |
| Monument, 5 years, read-only | [`0x45058ebe…`](https://tiramisu.explorer.arkiv.network/tx/0x45058ebe78aa07083398ea300401b1f44b21d33a347a277368f371c88712496d) | Claim + build of a monument: `readonly`, expiry 5 years out |
| Level upgrade (`patchEntity`) | [`0x6173b761…`](https://tiramisu.explorer.arkiv.network/tx/0x6173b761aeb49f2828c746e54c798c7f8aec7b3d7d8be0fa94634a25d489cf94) | Patches `style` on a house; every client checks the claim against the house's distinct signers |
| Presence as a lease | [`0xf87003da…`](https://tiramisu.explorer.arkiv.network/tx/0xf87003dac5fe338c43456835304bce886747634ce93a03634181e09e6f916cbf) | One batch: patch the islander's position (x, y) + extend the lease |
| 60-second speech | [`0xd903e4b0…`](https://tiramisu.explorer.arkiv.network/tx/0xd903e4b017e0b5c4c48a66e4960108e41b090b6480f8a788b58cc7aa9c7e3c1a) | A `readonly` say that lives exactly 30 blocks (60 s) |
| Guild charter | [`0x3d1dd5ff…`](https://tiramisu.explorer.arkiv.network/tx/0x3d1dd5ff68f957c22762663d75bb8352017d1dacd82135d83ee9b1044ebb0c2d) | The first Tideland entity: the Tidewrights charter, which later builds reference by key |

## Build on it (Open Source)

**The people harmed are the fans and builders around a game,** who today must reverse-engineer a private protocol (as
*The Crew Unlimited* did) or ask for an API key that can be revoked. Tideland's whole world is a documented public
dataset, and you need nobody's permission to use it:

- **The data contract:** [`arkiv/schema.md`](arkiv/schema.md) lists every entity type, attribute, lifetime and query.
  Everything Tideland writes carries `app = "tideland"`, `world = "s1"`.
- **A client in ~60 lines with no dependencies:** [`examples/raw-consumer.mjs`](examples/raw-consumer.mjs) speaks plain
  JSON-RPC (`arkiv_query`, `eth_blockNumber`), was written only from the schema, and prints whose house sinks next and
  who has been keeping it afloat (by real `$creator`). Run it with `node examples/raw-consumer.mjs`; nothing to install.
- **The rules, importable:** [`shared/tideland.js`](shared/tideland.js) is one ES module (queries, writes,
  `resolveTable`) used by our web client, CLI and bots alike. Import it to write a bot, a map, a leaderboard or a
  rival game on the same island.
- **Write your own bot:** start from [`examples/keeper.mjs`](examples/keeper.mjs) (about 60 lines). It makes its own
  key, finds the house that sinks soonest, skips houses flooded by a Puffer Pass pop as the rules ask, and adds an hour
  of life with a signed `tend`, so every client shows *your* address under "kept afloat by". Try
  `node examples/keeper.mjs --dry` first. Our nine guild bots ([`scripts/bots.mjs`](scripts/bots.mjs)) work the same
  way, in public CI.
- **Stability promise:** through judging and beyond, `world = "s1"` keeps its attribute names and meanings. New
  attributes are only added; anything breaking moves to `world = "s2"`, so `s1` readers never break.

## Reproduce it

**0. No install, just curl** (the tide map: everything that sinks within 24 h):

```bash
RPC=https://rpc.tiramisu.db-chain.testnet.arkiv.network
HEAD=$(curl -s $RPC -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | sed -E 's/.*"result":"([^"]+)".*/\1/')
curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"arkiv_query\",\"params\":[\"app = str('tideland') AND world = str('s1') AND \$expiresAt < u64($((HEAD + 43200)))\",{\"limit\":\"0xc8\",\"select\":{\"key\":true,\"owner\":true,\"expiresAt\":true,\"attributes\":true}}]}"
```

If the anonymous budget is used up (HTTP 429 `ANON_COST_LIMITED`), wait for the window to reset or add
`-H "X-API-KEY: <your key from hub.arkiv.network>"` (see [friction #1](arkiv/friction.md)).

**Fastest, in a browser: open the reader.** https://tideland.nerom.site/reader.html: homes and who kept them afloat, the tide map, Puffer
Pass winners, guestbook levels checked against real signers, and an address lookup by `$creator`/`$owner`. It's one file
that talks to Arkiv directly, so you can also save it and open it from disk.

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

**2. Play Puffer Pass:** open https://tideland.nerom.site → **🐡 Puffer Pass**. Move in first if asked (one transaction;
your browser key gets test GLM automatically). The island crew (bots with their own keys) sit with you. Tap a player to
throw: each throw is one `executeBatch` (a signed `pass` record + `changeOwnership`), linked in the table log. When the
fuse block passes, the puffer is gone from every query and the holder's house floods.

**3. Play a Keeper Run:** open https://tideland.nerom.site and press **Start a storm shift**, pick a keeper, start.
Your browser makes a local test key and tops it up with test GLM automatically. Click a commons with a red ring to run
there and hold to patch. Watch the HUD's batch counter and "last tx" link: each one is an `executeBatch` on Tiramisu.

**4. Build:** press **Play with a local key**, then **Get test GLM**. Click an open cell, name it,
pick a material and **Claim this cell**: a parcel and a house are created in one batch. Find a lighthouse you don't own and
**Tend the light**. Click any address to see what it built and what it holds.

**5. Run the web client and the tests locally:** `npm run dev` → http://localhost:5174 · `npm test`

## Limits, and who you trust

What a player or a judge has to trust, and what they don't:

| Part | Trusted? | Why |
|---|---|---|
| The world's state and history | No, it's on Arkiv | Anyone can read and check it; lifetimes are enforced by the network |
| Puffer Pass outcomes | No | Every client recomputes them from public records; invalid passes are ignored ([tests](test/rules.test.mjs)) |
| `api/crew.js` | **Yes, for the bots only** | It holds the nine bots' keys and signs their seats, passes and pops. It can't move a human's puffer or house; on-chain ownership checks stop it |
| `api/drip.js` | Barely | Sends test GLM; it never writes entities |
| `api/rpc.js` | Barely | A read-only relay used only when a visitor's anonymous budget runs out; it can't write |
| tideland.nerom.site | For convenience | Anyone can build and host the client from this repo |
| Arkiv / Tiramisu | **Yes** | It's a testnet: if the network goes down or is reset, so is the island |

Known limits:
- **Owners can still delete their own entities, even `readonly` ones** (and extend or transfer them; see
  [friction #7](arkiv/friction.md)). Monuments can be taken down by their owner. The puffer's fuse is safe because the
  rules read the readonly `fuse` attribute, not the expiry.
- **Bots act in public CI with our secrets.** If we stop the workflow, they stop tending. Their houses then sink like
  anyone else's.
- **Anonymous reads are rate-limited** (10,000 units per window, 100 per query). A heavy reader needs their own key.
- **No personal data at all.** Islander names are invented; players are keys.

## On-chain evidence (Tiramisu)

Wallets that create Tideland entities:

| Role | Address |
|---|---|
| Treasury (funds players' test GLM, never writes entities) | `0x15182825237e9E13F4822B7eb92eDf15E95470f9` |
| Tidewrights founder / villagers | `0x498307005DEe719Fb85Cb9A891bae8242d89c172` · `0x79F2A53cC10eBf38Bc3E889a0E8a2B1F3f5860F4` · `0x9C8f66a029e86e84A134EC0481F9eDDcf9806e20` |
| Granite Hands founder / villagers | `0xD321C6F69862Bb9273Ec55AfDD93Df43dEDA3157` · `0x1180F5ed4E3B5BbBbAeb1F67e34EC4C60c92c70B` · `0x455bDa4E6a28342763946f3688204a44Be1EE4BC` |
| Lamplighters founder / villagers | `0x6f5cB8FC63047Bce8Cc6C8c0ab0B2B0651BB3648` · `0x6B4744C8f41245072cA0DF98d32c34c36a2485bc` · `0x9b667162F892Cc7A7113CD00f736D03819982BED` |
| Harbour Trust (places the commons, never maintains them) | `0x643A28f7E81f398EC0a8Bc7460aAE1abc9A1721E` |
| A stranger's keeper bot ([`examples/keeper.mjs`](examples/keeper.mjs), a fresh key that isn't one of ours) | `0xd7C0C35F16cd2fe4F7a9b212E692EA02D65eC7e9` |
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
examples/            a third client in raw JSON-RPC (no SDK) and a stranger's keeper bot
web/public/reader.html  a fourth client: one HTML file, no build, no backend
test/                the Puffer Pass rules, tested as a pure function (npm test)
scripts/bots.mjs     the founding guilds
api/                 drip (test GLM) and read-only relay; no world logic
art/contact.png      the sprite sheet (Higgsfield renders, processed by scripts/art.mjs)
```

## Pre-existing work

The idea, the five entity types and the material-lifetime table come from the Tideland Ideathon entry (concept page,
August 2026: https://tideland-arkiv.vercel.app, no code). Everything in this repository, including the Arkiv integration,
the client, the CLI and the bots, was written from 15 October 2026. **Baseline commit:**
[`f166fc2e6428c22cb0f944b9d24306d35e9f4e92`](https://github.com/neromtoobad/tideland/commit/f166fc2e6428c22cb0f944b9d24306d35e9f4e92)
(15 Oct 2026, the first commit; nothing before it was reused). Sprites were generated for this build with Higgsfield.

MIT licensed. All on-chain content is synthetic.
