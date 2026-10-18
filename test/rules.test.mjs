// Puffer Pass rules are a pure function of the table's public records (resolveTable in shared/tideland.js).
// These tests feed it hand-made records, the same shape a query returns, and check that every client would read the
// same game: who popped, who won, and that cheats are ignored rather than trusted.   npm test
import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveTable, PUFFER } from "../shared/tideland.js"

const A = "0x000000000000000000000000000000000000000a", B = "0x000000000000000000000000000000000000000b"
const C = "0x000000000000000000000000000000000000000c", X = "0x00000000000000000000000000000000000000ff" // X never sat
let n = 0
const rec = (kind, creator, createdAt, attrs = {}, data = {}) => ({ key: `0x${(++n).toString(16).padStart(64, "0")}`, kind, creator, createdAt: BigInt(createdAt), attrs, data })
const seat = (who, at) => rec("seat", who, at, { home: `home-${who.slice(-1)}`, look: "kid" }, { name: who.slice(-1) })
// a serve is the first pass of a puffer and carries its fuse; later passes don't
const serve = (who, at, puffer, round, to, fuse) => rec("pass", who, at, { puffer, round, to, fuse: String(fuse) })
const pass = (who, at, puffer, round, to) => rec("pass", who, at, { puffer, round, to })
const seats3 = () => [seat(A, 1), seat(B, 2), seat(C, 3)]

test("a table with only seats is a lobby, and the pot is one ante per seat", () => {
  const r = resolveTable(null, seats3(), 50n)
  assert.equal(r.phase, "lobby")
  assert.equal(r.seats.length, 3)
  assert.equal(r.pot, 3 * PUFFER.anteMinutes)
})

test("whoever holds the puffer when its fuse block passes is out; the last one standing wins", () => {
  const recs = [...seats3(),
    serve(A, 10, "0xp1", 1, B, 100), pass(B, 20, "0xp1", 1, C), // C holds p1 at block 100: C pops
    serve(C, 110, "0xp2", 2, A, 200), pass(A, 120, "0xp2", 2, B), // B holds p2 at block 200: B pops
  ]
  const r = resolveTable(null, recs, 250n)
  assert.deepEqual(r.pops.map((p) => p.holder), [C.toLowerCase(), B.toLowerCase()])
  assert.equal(r.winner?.player, A.toLowerCase())
  assert.equal(r.phase, "done")
})

test("before the fuse block the round is live, and the current holder is whoever was passed it last", () => {
  const recs = [...seats3(), serve(A, 10, "0xp1", 1, B, 100), pass(B, 20, "0xp1", 1, C)]
  const r = resolveTable(null, recs, 60n)
  assert.equal(r.phase, "live")
  assert.equal(r.current.holder, C.toLowerCase())
  assert.equal(r.winner, null)
})

test("cheats are ignored by every client: passing what you don't hold, passing off the table, passing too late", () => {
  const recs = [...seats3(),
    serve(A, 10, "0xp1", 1, B, 100),
    pass(A, 20, "0xp1", 1, C), // A no longer holds it
    pass(B, 30, "0xp1", 1, X), // X has no seat
    pass(B, 100, "0xp1", 1, A), // signed at the fuse block: too late
  ]
  const r = resolveTable(null, recs, 150n)
  assert.equal(r.pops[0].holder, B.toLowerCase())
  assert.equal(r.pops[0].hops, 0)
})

test("the fuse is the serve's recorded block, so extending the puffer's expiry changes nothing", () => {
  // The holder owns the puffer and could extend its expiry on chain; the rules only read the readonly fuse attribute.
  const recs = [...seats3(), serve(A, 10, "0xp1", 1, B, 100)]
  assert.equal(resolveTable(null, recs, 100n).pops[0]?.holder, B.toLowerCase())
})

test("seats taken after the first serve, and second seats by the same player, don't count", () => {
  const recs = [seat(A, 1), seat(B, 2), seat(A, 3), serve(A, 10, "0xp1", 1, B, 100), seat(C, 11)]
  const r = resolveTable(null, recs, 50n)
  assert.deepEqual(r.seats.map((s) => s.player), [A.toLowerCase(), B.toLowerCase()])
  assert.equal(r.pot, 2 * PUFFER.anteMinutes)
})
