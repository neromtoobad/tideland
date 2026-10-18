// Messages in bottles: words nobody can take down. A bottle is read-only, can be extended by anyone, and is handed to a
// burn address in the transaction that creates it, so no one (the writer, us, anyone) can edit or delete it. It floats
// as long as strangers keep it afloat. See BOTTLE / throwBottle / keepBottle in shared/tideland.js.
import { BOTTLE, throwBottle, keepBottle, collect, keepsQuery, blocksToText } from "../../shared/tideland.js"

export function createBottles({ state, headNow, pub, ensureWallet, toast, modal, esc, short, explorer, refresh, sfx }) {
  const live = () => [...state.things.values()].filter((t) => t.kind === "bottle" && t.expiresAt > headNow())
  const keepsOf = (key) => [...state.things.values()].filter((t) => t.kind === "keep" && t.attrs?.bottle === key && t.expiresAt > headNow())
  const keepers = (b) => [...new Set(keepsOf(b.key).map((k) => k.creator.toLowerCase()).filter((c) => c !== b.creator.toLowerCase()))]
  const left = (b) => blocksToText(b.expiresAt - headNow())

  function list() {
    const bottles = live().sort((a, b) => keepers(b).length - keepers(a).length || (a.expiresAt < b.expiresAt ? 1 : -1))
    modal(`<h2>🍾 Messages in bottles</h2>
      <p class="note">Each bottle is read-only and belongs to nobody: it was handed to a burn address in the same transaction
      that made it, so not even its writer can delete it. It floats as long as strangers keep it afloat (+6 h each).</p>
      <div class="row" style="margin:6px 0 12px"><button class="primary" data-bottle-throw>Throw a bottle</button></div>
      ${bottles.length ? `<ol class="bottles">${bottles.map((b) => `<li data-bottle="${b.key}"><span class="bq">“${esc(b.data?.text ?? "")}”</span>
        <span class="bm">${keepers(b).length ? `kept afloat by ${keepers(b).length} ${keepers(b).length === 1 ? "stranger" : "strangers"}` : "nobody has kept it yet"} · sinks in ${left(b)}</span></li>`).join("")}</ol>`
        : `<p class="note">The sea is empty right now. Be the first to throw one.</p>`}`)
  }

  async function open(key) {
    const b = state.things.get(key)
    if (!b) return list()
    const ks = keepsOf(key)
    modal(`<h2>🍾 A message in a bottle</h2>
      <blockquote class="bottle-text">“${esc(b.data?.text ?? "")}”${b.data?.from ? `<cite>— ${esc(b.data.from)}</cite>` : ""}</blockquote>
      <dl class="bottle-facts">
        <div><dt>Thrown by</dt><dd><a href="${explorer}/address/${b.creator}" target="_blank" rel="noopener">${short(b.creator)}</a></dd></div>
        <div><dt>Owned by</dt><dd><b>nobody</b> <span class="mono">${short(b.owner)}</span> (a burn address: it can never be deleted)</dd></div>
        <div><dt>Sinks in</dt><dd><b>${left(b)}</b> unless someone keeps it afloat</dd></div>
        <div><dt>Kept afloat by</dt><dd>${ks.length ? ks.slice(0, 6).map((k) => `<a href="${explorer}/address/${k.creator}" target="_blank" rel="noopener">${short(k.creator)}</a>`).join(", ") + (ks.length > 6 ? ` +${ks.length - 6}` : "") : "nobody yet"}</dd></div>
      </dl>
      <div class="row"><button class="primary" data-bottle-keep="${b.key}">Keep it afloat (+6 h)</button>
        <a class="ghost btnlike" href="${explorer}/entity/${b.key}" target="_blank" rel="noopener">See it on Arkiv</a>
        <button class="ghost" data-bottle-list>All bottles</button></div>`)
  }

  function throwForm() {
    modal(`<h2>🍾 Throw a bottle</h2>
      <p class="note">Up to ${BOTTLE.maxChars} characters. Once it's in the sea, nobody can edit or delete it, including you.
      It floats for a day, and longer if strangers keep it afloat. Please don't write anything personal: this is public, forever-readable test data.</p>
      <textarea id="bottle-text" maxlength="${BOTTLE.maxChars}" rows="3" placeholder="Something worth keeping afloat…"></textarea>
      <input id="bottle-from" maxlength="40" placeholder="Signed (optional, any name)" />
      <div class="row"><button class="primary" data-bottle-send>Throw it into the sea</button><button class="ghost" data-bottle-list>Back</button></div>`)
    setTimeout(() => document.getElementById("bottle-text")?.focus(), 50)
  }

  async function send(btn) {
    const text = document.getElementById("bottle-text").value.trim(), from = document.getElementById("bottle-from").value.trim()
    if (!text) return toast("Write something first.", 3000)
    btn.disabled = true; btn.textContent = "Sealing the bottle…"
    try {
      const w = await ensureWallet(); if (!w) throw new Error("No test GLM yet; try again in a moment.")
      const r = await throwBottle(w.client, pub(), { text, from })
      sfx?.wave?.()
      toast(`🍾 Your bottle is in the sea. Nobody can take it down. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">tx</a>`, 7000)
      await refresh().catch(() => {})
      open(r.key)
    } catch (e) { btn.disabled = false; btn.textContent = "Throw it into the sea"; toast(`Couldn't throw it: ${esc(e.shortMessage || e.message)}`, 7000) }
  }

  async function keep(btn, key) {
    const b = state.things.get(key); if (!b) return
    btn.disabled = true; btn.textContent = "Keeping it afloat…"
    try {
      const w = await ensureWallet(); if (!w) throw new Error("No test GLM yet; try again in a moment.")
      const r = await keepBottle(w.client, pub(), { bottle: b, note: "Kept afloat" })
      if (r.full) { toast("It's already afloat for a week. Come back later.", 4000); btn.disabled = false; btn.textContent = "Keep it afloat (+6 h)"; return }
      sfx?.clutch?.()
      toast(`🍾 Kept afloat: +6 h, signed by you. <a href="${explorer}/tx/${r.txHash}" target="_blank" rel="noopener">tx</a>`, 6000)
      await refresh().catch(() => {})
      open(key)
    } catch (e) { btn.disabled = false; btn.textContent = "Keep it afloat (+6 h)"; toast(`Couldn't keep it: ${esc(e.shortMessage || e.message)}`, 7000) }
  }

  document.addEventListener("click", (e) => {
    const t = e.target
    if (t.closest("[data-bottle-throw]")) throwForm()
    else if (t.closest("[data-bottle-list]")) list()
    else if (t.closest("[data-bottle-send]")) send(t.closest("[data-bottle-send]"))
    else if (t.closest("[data-bottle-keep]")) keep(t.closest("[data-bottle-keep]"), t.closest("[data-bottle-keep]").dataset.bottleKeep)
    else if (t.closest("li[data-bottle]")) open(t.closest("li[data-bottle]").dataset.bottle)
  })

  return { live, list, open, throwForm, keepers }
}
