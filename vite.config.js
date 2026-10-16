import { defineConfig } from "vite"
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"

// Dev only: serve api/*.js (the Vercel functions) from the Vite server, with keys read from ~/.tideland.
function devApi() {
  const keyFile = (n) => `${homedir()}/.tideland/${n}`
  if (!process.env.TREASURY_KEY && existsSync(keyFile("treasury.key"))) process.env.TREASURY_KEY = readFileSync(keyFile("treasury.key"), "utf8").trim()
  if (!process.env.BOT_SEED && existsSync(keyFile("bots.seed"))) process.env.BOT_SEED = readFileSync(keyFile("bots.seed"), "utf8").trim()
  if (!process.env.ARKIV_ACCESS_KEY && existsSync(keyFile("access.key"))) process.env.ARKIV_ACCESS_KEY = readFileSync(keyFile("access.key"), "utf8").trim()
  return {
    name: "dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url.match(/^\/api\/(drip|rpc|crew)\b/)
        if (!m) return next()
        let raw = ""; for await (const c of req) raw += c
        req.body = raw ? JSON.parse(raw) : {}
        res.status = (code) => { res.statusCode = code; return res }
        res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)) }
        res.send = (t) => res.end(t)
        const mod = await server.ssrLoadModule(new URL(`./api/${m[1]}.js`, import.meta.url).pathname)
        try { await mod.default(req, res) } catch (e) { res.status(500).json({ error: e.message }) }
      })
    },
  }
}

export default defineConfig({
  root: "web",
  plugins: [devApi()],
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
  server: { port: 5174 },
})
