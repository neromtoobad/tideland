// The Tideland data contract in code. Shared by the web client, the CLI and the bots, so every
// reader draws the same world from the same rules. See /arkiv/schema.md for the prose version.
import { createPublicClient, createWalletClient, ExpirationTime, jsonToPayload } from "@arkiv-network/sdk"
import { i32, key as keyAttr, str, u64 } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { and, eq, gte, lt, lte, or } from "@arkiv-network/sdk/query"
import { http, webSocket } from "viem"

export const APP = "tideland"
export const WORLD = "s1"
export const SIZE = 32 // the coast is a 32x32 grid
export const BLOCK_SECONDS = 2
export const DAY_BLOCKS = 43200n

// Material is lifetime. `days` is the span a build or a renewal buys, counted from now.
export const MATERIALS = {
  driftwood: { label: "Driftwood camp", seconds: 6 * 3600, flags: {}, blurb: "Washed-up timber. Gone by tonight unless tended." },
  pine: { label: "Pine house", seconds: 7 * 86400, flags: {}, blurb: "A week of shelter. Renew it or the tide takes it." },
  stone: { label: "Stone house", seconds: 90 * 86400, flags: {}, blurb: "A season. Costs more, outlasts most of its neighbours." },
  monument: { label: "Monument", seconds: 5 * 365 * 86400, flags: { readonly: true }, blurb: "Five years, prepaid. Its words can never be edited." },
  lighthouse: { label: "Lighthouse", seconds: 3 * 86400, flags: { permissionlessExtension: true }, commons: true, blurb: "A commons. Anyone on the coast can keep it lit." },
  // The harbour's commons: short-lived, permissionless, and the targets of a Keeper Run.
  buoy: { label: "Bell buoy", seconds: 2 * 3600, flags: { permissionlessExtension: true }, commons: true, blurb: "Rings ships home. Two hours of float unless someone patches it." },
  jetty: { label: "Jetty", seconds: 12 * 3600, flags: { permissionlessExtension: true }, commons: true, blurb: "Everyone's boats tie up here. Nobody owns the upkeep." },
  seawall: { label: "Sea wall", seconds: 86400, flags: { permissionlessExtension: true }, commons: true, blurb: "Holds the sea off the houses behind it, for a day at a time." },
}
export const BUILDABLE = ["driftwood", "pine", "stone", "monument", "lighthouse"]

// ---------- Homes: the personal heart of the game ----------
// A home belongs to you but is created with permissionlessExtension, so only other people can really keep
// it alive. It starts with 12 hours and can never hold more than 3 days: it needs friends, often.
export const HOME_START_SECONDS = 12 * 3600
export const HOME_MAX_SECONDS = 3 * 86400
export const HOME_STYLES = ["pine", "stone", "driftwood"]
export const TEND_SECONDS = 30 * 86400 // a guestbook line is remembered for a month

export function buildHome(wallet, { x, y, name, style }) {
  return wallet.createEntity({
    attributes: { ...common("home"), x: i32(x), y: i32(y), style: str(HOME_STYLES.includes(style) ? style : "pine") },
    payload: jsonToPayload({ name: String(name).slice(0, 40) }),
    contentType: "application/json",
    expires: ExpirationTime.fromSeconds(HOME_START_SECONDS),
    flags: { permissionlessExtension: true },
  })
}

/**
 * Keep a home afloat: ONE atomic batch that extends the home to `target` AND writes a signed tend record
 * (who, how long, an optional note). Either both land or neither, so the guestbook can never claim a save
 * that didn't happen, and every save has a verifiable author ($creator of the tend record).
 */
export function tendHome(wallet, { home, target, minutes, note }) {
  return wallet.executeBatch({
    extensions: [{ entityKey: home.key, expires: ExpirationTime.atBlock(target) }],
    creates: [{
      attributes: { ...common("tend"), home: keyAttr(home.key), minutes: i32(Math.round(minutes)) },
      payload: jsonToPayload({ note: String(note ?? "").slice(0, 80) }),
      contentType: "application/json",
      expires: ExpirationTime.fromSeconds(TEND_SECONDS),
      flags: { readonly: true },
    }],
  })
}
export const homeMaxExpiry = (head) => head + lifetimeBlocks(HOME_MAX_SECONDS)

/**
 * Add `addBlocks` of life to a home on top of whatever it has NOW. If someone else extended it first,
 * our target would shorten its life and the engine reverts the whole batch (so no false guestbook line);
 * we then re-read its expiry and stack our time on top of theirs, once.
 */
export async function keepAfloat(wallet, reader, { home, addBlocks, note }) {
  for (let attempt = 0; ; attempt++) {
    const head = (await reader.getBlockTiming()).currentBlock
    const cap = homeMaxExpiry(head)
    const base = home.expiresAt > head ? home.expiresAt : head
    const target = base + addBlocks > cap ? cap : base + addBlocks
    if (target <= home.expiresAt) return { full: true }
    const minutes = (Number(target - home.expiresAt) * BLOCK_SECONDS) / 60
    try {
      const r = await tendHome(wallet, { home, target, minutes, note })
      return { ...r, target, minutes }
    } catch (e) {
      if (attempt > 0 || !/shorten/i.test(String(e.message))) throw e
      home = toThing(await reader.getEntity(home.key))
    }
  }
}
export const COMMONS = Object.keys(MATERIALS).filter((k) => MATERIALS[k].commons)
export const PARCEL_SECONDS = 14 * 86400
export const GUILD_SECONDS = 30 * 86400
export const INSCRIPTION_SPANS = { day: 86400, week: 7 * 86400, month: 30 * 86400, year: 365 * 86400 }

export const lifetimeBlocks = (seconds) => BigInt(seconds / BLOCK_SECONDS)

export const RPC_URL = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
// Node callers (bots, CLI) pick up an optional access key; browsers never carry one.
const envKey = () => globalThis.process?.env?.ARKIV_ACCESS_KEY || undefined

/**
 * Fail fast instead of retrying: the public RPC answers an exhausted anonymous budget with HTTP 429
 * (ANON_COST_LIMITED), and viem's default retry-with-backoff turns that into a silent ~40 s hang.
 */
function transport({ rpc = RPC_URL, apiKey = envKey() } = {}) {
  return http(rpc, { retryCount: 0, timeout: 20_000, fetchOptions: apiKey ? { headers: { "X-API-KEY": apiKey } } : undefined })
}

export function publicClient({ ws = false, rpc, apiKey } = {}) {
  return createPublicClient({ chain: tiramisu, transport: ws ? webSocket() : transport({ rpc, apiKey }) })
}

export function walletClient(account, opts) {
  return createWalletClient({ chain: tiramisu, transport: transport(opts), account })
}

/** True when the node refused for budget (HTTP 429). viem nests the HTTP error under one or more `cause`s. */
export function isBudgetError(e) {
  for (let cur = e, depth = 0; cur && depth < 8; cur = cur.cause, depth++) {
    if (cur.status === 429 || /ANON_COST_LIMITED|Status: 429|status 429/i.test(`${cur.details ?? ""} ${cur.message ?? ""}`)) return true
  }
  return false
}

const base = (kind) => [eq("app", APP), eq("world", WORLD), eq("kind", kind)]
const common = (kind) => ({ app: APP, world: WORLD, kind })

// ---------- reads ----------

const FIELDS = { key: true, owner: true, creator: true, createdAt: true, expiresAt: true, creationFlags: true, attributes: true, payload: true }

/** Walks every page of a query (max 200 per page) and returns plain world objects. */
export async function collect(builder) {
  const out = []
  let page = await builder.limit(200).fetch()
  for (;;) {
    for (const e of page.entities) out.push(toThing(e))
    if (!page.hasNextPage()) break
    page = await page.next()
  }
  return out
}

/** Everything alive in the world (all kinds), optionally limited to a rectangle. */
export function worldQuery(client, rect) {
  const filters = [eq("app", APP), eq("world", WORLD)]
  if (rect) filters.push(gte("x", i32(rect.x0)), lte("x", i32(rect.x1)), gte("y", i32(rect.y0)), lte("y", i32(rect.y1)))
  return client.select(FIELDS).where(filters)
}

/** The tide map: everything that sinks before `head + withinBlocks`. */
export function tideQuery(client, head, withinBlocks = DAY_BLOCKS) {
  return client.select(FIELDS).where(eq("app", APP), eq("world", WORLD), lt("$expiresAt", u64(head + withinBlocks)))
}

export const legacyQuery = (client, address) => client.select(FIELDS).where(base("structure")).createdBy(address)
export const estateQuery = (client, address) => client.select(FIELDS).where(base("parcel")).ownedBy(address)
export const guildFootprintQuery = (client, guildKey) =>
  client.select({ key: true }).where(...base("structure"), eq("guild", keyAttr(guildKey)))
export const guildsQuery = (client) => client.select(FIELDS).where(base("guild"))

export function toThing(e) {
  const a = {}
  for (const [k, v] of Object.entries(e.attributes ?? {})) a[k] = v.value
  let data = {}
  try { data = e.payload && e.payload.length ? JSON.parse(new TextDecoder().decode(e.payload)) : {} } catch {}
  return {
    key: e.key,
    kind: a.kind,
    x: a.x === undefined ? undefined : Number(a.x),
    y: a.y === undefined ? undefined : Number(a.y),
    material: a.material ?? (a.kind === "home" ? a.style : undefined),
    style: a.style,
    home: a.home,
    parcel: a.parcel,
    guild: a.guild,
    owner: e.owner,
    creator: e.creator,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
    flags: e.creationFlags,
    attrs: a,
    data,
  }
}

/**
 * The claim rule. A cell belongs to the live parcel there with the lowest $createdAt (then lowest key).
 * Returns Map "x:y" -> { parcel, contested: Parcel[], structure, inscriptions }.
 */
export function layout(things) {
  const cells = new Map()
  const cell = (x, y) => {
    const id = `${x}:${y}`
    if (!cells.has(id)) cells.set(id, { x, y, parcels: [], structures: [], inscriptions: [] })
    return cells.get(id)
  }
  for (const t of things) {
    if (t.x === undefined) continue
    if (t.kind === "parcel") cell(t.x, t.y).parcels.push(t)
    else if (t.kind === "structure" || t.kind === "home") cell(t.x, t.y).structures.push(t)
    else if (t.kind === "inscription") cell(t.x, t.y).inscriptions.push(t)
  }
  const byAge = (a, b) => (a.createdAt === b.createdAt ? (a.key < b.key ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)
  for (const c of cells.values()) {
    c.parcels.sort(byAge)
    c.parcel = c.parcels[0]
    c.contested = c.parcels.slice(1)
    // Only a structure on the winning parcel counts; others are squatters drawn as ghosts.
    c.structures.sort(byAge)
    // Commons stand on open coast with no parcel; anything else must sit on the winning parcel.
    const isCommons = (s) => s.kind === "home" || (!s.parcel && MATERIALS[s.material]?.commons)
    c.structure = c.structures.find((s) => c.parcel && s.parcel === c.parcel.key) ?? c.structures.find(isCommons) ?? null
    c.squatters = c.structures.filter((s) => s !== c.structure && !isCommons(s))
  }
  return cells
}

/** 0..1 share of its material lifetime still left. */
export function lifeLeft(thing, head) {
  const span = thing.kind === "parcel" ? lifetimeBlocks(PARCEL_SECONDS)
    : thing.kind === "home" ? lifetimeBlocks(HOME_MAX_SECONDS)
    : thing.kind === "guild" ? lifetimeBlocks(GUILD_SECONDS)
    : thing.material ? lifetimeBlocks(MATERIALS[thing.material].seconds)
    : DAY_BLOCKS
  const left = Number(thing.expiresAt - head)
  return Math.max(0, Math.min(1, left / Number(span)))
}

export function blocksToText(blocks) {
  let s = Number(blocks) * BLOCK_SECONDS
  if (s <= 0) return "sunk"
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60)
  if (d >= 365) return `${(d / 365).toFixed(1)} y`
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} m`
  return `${m} m`
}

// ---------- writes (each is one transaction) ----------

const parcelCreate = ({ x, y, name, guild }) => ({
  attributes: { ...common("parcel"), x: i32(x), y: i32(y), ...(guild ? { guild: keyAttr(guild) } : {}) },
  payload: jsonToPayload({ name }),
  contentType: "application/json",
  expires: ExpirationTime.fromSeconds(PARCEL_SECONDS),
})

const structureCreate = ({ x, y, parcelKey, name, material, guild, note }) => ({
  attributes: { ...common("structure"), x: i32(x), y: i32(y), material: str(material), parcel: keyAttr(parcelKey), ...(guild ? { guild: keyAttr(guild) } : {}) },
  payload: jsonToPayload({ name, note: note ?? "" }),
  contentType: "application/json",
  expires: ExpirationTime.fromSeconds(MATERIALS[material].seconds),
  flags: MATERIALS[material].flags,
})

/**
 * Claim an empty cell and build on it in ONE atomic batch: land and house land together or not at all.
 * The structure must point at its parcel's key before that key exists, so we predict both keys from
 * the signer's nonce and pin each create to the salt that mints its predicted key.
 */
export async function claimAndBuild(wallet, { x, y, name, material, guild }, reader = publicClient()) {
  const owner = wallet.account.address
  if (!material) {
    const { createdEntities, txHash } = await wallet.executeBatch({ creates: [parcelCreate({ x, y, name, guild })] })
    return { parcelKey: createdEntities[0], txHash }
  }
  // predictEntityKeys lives on the public client only (see friction.md), so the reader predicts.
  const [p, s] = await reader.predictEntityKeys({ owner, count: 2 })
  const { createdEntities, txHash } = await wallet.executeBatch({
    creates: [
      { ...parcelCreate({ x, y, name, guild }), salt: p.salt },
      { ...structureCreate({ x, y, parcelKey: p.key, name, material, guild }), salt: s.salt },
    ],
  })
  if (createdEntities[0] !== p.key) throw new Error(`parcel key moved (predicted ${p.key}, minted ${createdEntities[0]}); another write from this wallet was in flight`)
  return { parcelKey: createdEntities[0], structureKey: createdEntities[1], txHash }
}

/** Build on a parcel you already hold. */
export function build(wallet, args) {
  return wallet.createEntity(structureCreate(args))
}

/** Renew a structure and its parcel together, so a house is never kept alive on land that lapsed. */
export function renew(wallet, { structure, parcel }) {
  const extensions = []
  if (structure) extensions.push({ entityKey: structure.key, expires: ExpirationTime.fromSeconds(MATERIALS[structure.material].seconds) })
  if (parcel) extensions.push({ entityKey: parcel.key, expires: ExpirationTime.fromSeconds(PARCEL_SECONDS) })
  return wallet.executeBatch({ extensions })
}

/** Tend a lighthouse you do not own. Works only because it was created with permissionlessExtension. */
export function tend(wallet, lighthouse) {
  return wallet.extendEntity({ entityKey: lighthouse.key, expires: ExpirationTime.fromSeconds(MATERIALS.lighthouse.seconds) })
}

export function inscribe(wallet, { x, y, text, span }) {
  return wallet.createEntity({
    attributes: { ...common("inscription"), x: i32(x), y: i32(y) },
    payload: jsonToPayload({ text: String(text).slice(0, 140) }),
    contentType: "application/json",
    expires: ExpirationTime.fromSeconds(INSCRIPTION_SPANS[span] ?? INSCRIPTION_SPANS.week),
    flags: { readonly: true },
  })
}

// ---------- Keeper Run ----------

/** One tick of patching buys this share of a commons' full span (buoy 3 min, jetty 18 min, wall 36 min, light 1.8 h). */
export const PATCH_SHARE = 0.025
export const patchBlocks = (material) => BigInt(Math.round((MATERIALS[material].seconds / BLOCK_SECONDS) * PATCH_SHARE))
/** A commons can never be patched beyond its full span from now. */
export const maxExpiry = (material, head) => head + lifetimeBlocks(MATERIALS[material].seconds)

/**
 * Seal queued patches in one atomic batch. Each entry sets an absolute target block, computed from the
 * freshest known expiry (kept current by ExpiryExtended events), so the batch only ever moves expiries later.
 */
export function sealPatches(wallet, patches) {
  return wallet.executeBatch({ extensions: patches.map((p) => ({ entityKey: p.key, expires: ExpirationTime.atBlock(p.target) })) })
}

/** A finished run. Read-only, and remembered for longer the better it was: the leaderboard decays too. */
export const runLifetimeSeconds = (score) => Math.min(30 * 86400, Math.max(3600, Math.round(score) * 12))
export function recordRun(wallet, { score, saved, patches, batches, maxCombo, keeper, txs }) {
  return wallet.createEntity({
    attributes: { ...common("run"), score: i32(Math.round(score)), saved: i32(Math.round(saved)), patches: i32(patches), keeper: str(keeper) },
    payload: jsonToPayload({ batches, maxCombo, txs: txs.slice(0, 40) }),
    contentType: "application/json",
    expires: ExpirationTime.fromSeconds(runLifetimeSeconds(score) - (runLifetimeSeconds(score) % BLOCK_SECONDS)),
    flags: { readonly: true },
  })
}
export const homesQuery = (client) => client.select(FIELDS).where(base("home"))
export const tendsQuery = (client, homeKey) => client.select(FIELDS).where(...base("tend"), eq("home", keyAttr(homeKey)))
export const tendsByQuery = (client, address) => client.select(FIELDS).where(base("tend")).createdBy(address)
export const runsQuery = (client) => client.select(FIELDS).where(base("run"))
export const commonsQuery = (client) => client.select(FIELDS).where(base("structure"), or(COMMONS.map((m) => eq("material", m))))

/** Place a commons (anyone can; the Harbour Trust bot does it on a schedule). */
export function placeCommons(wallet, { x, y, material, name, wear = 0 }) {
  // `wear` (0..0.85) sets it adrift already worn: its span is the most it can ever be patched up to.
  const seconds = Math.max(600, Math.round(MATERIALS[material].seconds * (1 - wear) / BLOCK_SECONDS) * BLOCK_SECONDS)
  return wallet.createEntity({
    attributes: { ...common("structure"), x: i32(x), y: i32(y), material: str(material) },
    payload: jsonToPayload({ name, note: "" }),
    contentType: "application/json",
    expires: ExpirationTime.fromSeconds(seconds),
    flags: MATERIALS[material].flags,
  })
}

export function foundGuild(wallet, { name, color, motto }) {
  return wallet.createEntity({
    attributes: { ...common("guild"), name: str(name) },
    payload: jsonToPayload({ name, color, motto }),
    contentType: "application/json",
    expires: ExpirationTime.fromSeconds(GUILD_SECONDS),
  })
}

/** Hand land to someone else. $creator (the founder) stays; $owner (the holder) changes. */
export function sell(wallet, { parcel, structure, to }) {
  const ownershipChanges = [{ entityKey: parcel.key, newOwner: to }]
  if (structure && structure.owner?.toLowerCase() === parcel.owner?.toLowerCase()) ownershipChanges.push({ entityKey: structure.key, newOwner: to })
  return wallet.executeBatch({ ownershipChanges })
}
