// A small moment of joy: confetti and a message, for a saved house or a good day.
import { sfx } from "./sfx.js"

export function celebrate(title, line = "") {
  const wrap = document.createElement("div")
  wrap.className = "celebrate"
  wrap.innerHTML = `<div class="cel-card"><b>${title}</b>${line ? `<span>${line}</span>` : ""}</div>`
  const colors = ["#1f6e68", "#b4552e", "#96762b", "#7fb7ae", "#e7b65a", "#c9a66b"]
  for (let i = 0; i < 90; i++) {
    const c = document.createElement("i")
    c.style.left = `${Math.random() * 100}%`
    c.style.background = colors[i % colors.length]
    c.style.animationDelay = `${Math.random() * 0.6}s`
    c.style.animationDuration = `${2.2 + Math.random() * 1.6}s`
    wrap.appendChild(c)
  }
  document.body.appendChild(wrap)
  sfx.clutch(); setTimeout(() => sfx.bell(), 250)
  wrap.addEventListener("click", () => wrap.remove())
  setTimeout(() => wrap.remove(), 4800)
}
