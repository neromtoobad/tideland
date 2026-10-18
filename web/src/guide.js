// A short, skippable step-by-step guide (cards with a picture, a title and a line or two). Shown once per guide on
// first visit (remembered in localStorage) and always available again from "How to play".
import { spriteUrl } from "./render.js"

const seen = (id) => { try { return localStorage.getItem(`tideland.guide.${id}`) === "1" } catch { return false } }
const remember = (id) => { try { localStorage.setItem(`tideland.guide.${id}`, "1") } catch {} }

export const GUIDES = {
  island: [
    { img: ["weaver-waving", "fisher-waving", "kid-waving"], title: "An island where everything expires",
      text: "Every house, meal, night's sleep and word said here is an entry on Arkiv with a lifetime. When its time runs out, it's gone, for everyone. Nobody runs a server that decides." },
    { img: ["driftwood", "weaver-eating"], title: "Your islander needs other people",
      text: "Move in and your islander gets a little house. You can fish and put them to bed, but you can't keep your own house afloat: only friends' visits can. Every visitor signs the book, and the house grows." },
    { img: ["puffer-full"], title: "Puffer Pass: the main game",
      text: "Hot potato with a pufferfish. Everyone stakes 2 hours of their house. The puffer's Arkiv expiry is the fuse: whoever holds it when it pops is out, and the last one standing takes the pot." },
    { img: ["lighthouse"], title: "A free key, no wallet needed",
      text: "Your browser makes its own test key and tops it up with free test GLM the first time you do something. Nothing here costs real money. You can also use your own wallet from the 🔑 button." },
  ],
  puffer: [
    { img: ["kid-waving", "fisher-waving", "elder-waving"], title: "Sit at a table",
      text: "Start a table and the island crew (bots with houses of their own) sit with you, or send the invite link to friends. Everyone stakes 2 hours of their house into the pot." },
    { img: ["puffer-calm", "puffer-full"], title: "The puffer swells until it pops",
      text: "The puffer is an Arkiv entry whose expiry is a block about a minute away: that's the fuse. Nobody knows exactly when. It swells and shakes as the block gets close, and when the block comes, it pops." },
    { img: ["puffer-full"], title: "Tap someone to throw it", action: true,
      text: "When it's yours, tap another islander, or one of the buttons at the bottom. Each throw is a real transaction from your key and lands in a block or two, so don't wait until the last second." },
    { img: ["weaver-sad", "carpenter-waving"], title: "Pop and you're out",
      text: "Whoever holds it at the pop is out and their house floods for 6 hours. They serve the next puffer. The last islander standing takes the whole pot onto their house." },
  ],
}

/** Show a guide. `force` shows it even if it was seen before. Resolves when closed. */
export function showGuide(id, { force = false } = {}) {
  if (!force && seen(id)) return Promise.resolve(false)
  const slides = GUIDES[id]
  return new Promise((resolve) => {
    let i = 0
    const el = document.createElement("div")
    el.className = "guide"
    el.innerHTML = `<div class="guide-card" role="dialog" aria-modal="true" aria-label="How to play"><button class="guide-skip" data-g="skip">Skip</button><div class="guide-body"></div>
      <div class="guide-foot"><div class="guide-dots"></div><div class="guide-btns"><button class="ghost" data-g="back">Back</button><button class="primary" data-g="next">Next</button></div></div></div>`
    document.body.appendChild(el)
    const paint = () => {
      const s = slides[i]
      el.querySelector(".guide-body").innerHTML = `<div class="guide-art">${s.img.map((n) => `<img src="${spriteUrl(n)}" alt="" />`).join("")}${s.action ? `<span class="guide-tap">👆</span>` : ""}</div>
        <div class="guide-step">${i + 1} of ${slides.length}</div><h2>${s.title}</h2><p>${s.text}</p>`
      el.querySelector(".guide-dots").innerHTML = slides.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")
      el.querySelector('[data-g="back"]').style.visibility = i ? "visible" : "hidden"
      el.querySelector('[data-g="next"]').textContent = i === slides.length - 1 ? "Got it, let's play" : "Next"
    }
    const done = () => { remember(id); el.classList.add("out"); setTimeout(() => el.remove(), 200); removeEventListener("keydown", key); resolve(true) }
    const key = (e) => { if (e.key === "Escape") done(); else if (e.key === "ArrowRight" || e.key === "Enter") go(1); else if (e.key === "ArrowLeft") go(-1) }
    const go = (d) => { i += d; if (i >= slides.length) return done(); i = Math.max(0, i); paint() }
    el.addEventListener("click", (e) => {
      const a = e.target.closest("[data-g]")?.dataset.g
      if (a === "next") go(1); else if (a === "back") go(-1); else if (a === "skip") done()
      else if (e.target === el) done()
    })
    addEventListener("keydown", key)
    paint()
  })
}
