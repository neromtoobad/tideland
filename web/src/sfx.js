// All sound is synthesised with Web Audio at runtime: no audio files, nothing licensed.
let ctx = null, master = null, wind = null
export let muted = false

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination)
  }
  if (ctx.state === "suspended") ctx.resume()
  return ctx
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.7 }

function noiseBuffer(seconds = 1) {
  const a = ac(), b = a.createBuffer(1, a.sampleRate * seconds, a.sampleRate), d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return b
}
function env(g, t, a, peak, release) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + release)
}
function tone(freq, { type = "sine", at = 0, dur = 0.25, peak = 0.3, glide } = {}) {
  const a = ac(), t = a.currentTime + at, o = a.createOscillator(), g = a.createGain()
  o.type = type; o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur)
  env(g, t, 0.005, peak, dur); o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05)
}
function noise({ at = 0, dur = 0.2, peak = 0.3, freq = 1200, q = 0.8, type = "bandpass" } = {}) {
  const a = ac(), t = a.currentTime + at, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain()
  s.buffer = noiseBuffer(dur + 0.1); f.type = type; f.frequency.value = freq; f.Q.value = q
  env(g, t, 0.004, peak, dur); s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.1)
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]
const note = (step) => 392 * Math.pow(2, PENTA[Math.min(step, PENTA.length - 1)] / 12)

export const sfx = {
  hammer(combo = 0) {
    if (muted) return
    noise({ dur: 0.06, peak: 0.35, freq: 1800, q: 1.2 })
    tone(140, { type: "triangle", dur: 0.09, peak: 0.35, glide: 70 })
    tone(note(Math.floor(combo / 2)), { type: "triangle", at: 0.02, dur: 0.18, peak: 0.12 })
  },
  clutch() { if (muted) return; [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, s / 12), { at: i * 0.05, dur: 0.4, peak: 0.14, type: "triangle" })) },
  bell() { if (muted) return; tone(880, { dur: 1.4, peak: 0.12 }); tone(1320, { dur: 1.0, peak: 0.05 }); tone(2210, { dur: 0.6, peak: 0.03 }) },
  wave() { if (muted) return; noise({ dur: 1.4, peak: 0.22, freq: 500, q: 0.4, type: "lowpass" }) },
  sink() { if (muted) return; tone(330, { dur: 0.8, peak: 0.18, glide: 90, type: "sawtooth" }); noise({ at: 0.1, dur: 0.6, peak: 0.12, freq: 700 }) },
  full() { if (muted) return; tone(660, { dur: 0.08, peak: 0.08, type: "square" }) },
  start() { if (muted) return; [0, 7, 12].forEach((s, i) => tone(262 * Math.pow(2, s / 12), { at: i * 0.12, dur: 0.5, peak: 0.16, type: "triangle" })) },
  end() { if (muted) return; [12, 7, 4, 0].forEach((s, i) => tone(262 * Math.pow(2, s / 12), { at: i * 0.14, dur: 0.6, peak: 0.14, type: "triangle" })) },
  storm(on) {
    const a = ac()
    if (on && !wind) {
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain()
      s.buffer = noiseBuffer(4); s.loop = true; f.type = "lowpass"; f.frequency.value = 420; g.gain.value = muted ? 0 : 0.09
      lfo.frequency.value = 0.15; lg.gain.value = 220; lfo.connect(lg).connect(f.frequency)
      s.connect(f).connect(g).connect(master); s.start(); lfo.start(); wind = { s, lfo, g }
    } else if (!on && wind) {
      wind.g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 1.2); const w = wind; setTimeout(() => { w.s.stop(); w.lfo.stop() }, 1400); wind = null
    }
  },
}
