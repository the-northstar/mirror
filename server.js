/**
 * Dev + production server. Runs the API routes next to the built frontend so
 * the app works with `npm run dev` alone, on any Node host, with no platform
 * lock-in.
 *
 * The route handlers are plain (Request) => Response, so they stay portable to
 * Vercel/Netlify/Workers unchanged.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

// Load .env without a dependency.
if (existsSync('.env')) {
  for (const line of (await readFile('.env', 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const PORT = Number(process.env.PORT) || 3000
const DIST = 'dist'

const { default: analyze } = await import('./api/analyze.ts')
const { default: tryon } = await import('./api/tryon.ts')
const { default: upload } = await import('./api/upload.ts')
const ROUTES = {
  '/api/analyze': analyze,
  '/api/tryon': tryon,
  '/api/upload': upload,
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const route = ROUTES[url.pathname]

  if (route) {
    try {
      // Node's IncomingMessage -> web Request, which is what the handlers take.
      const body =
        req.method === 'GET' || req.method === 'HEAD' ? undefined : req
      const response = await route(
        new Request(url, {
          method: req.method,
          headers: req.headers,
          body,
          duplex: 'half',
        }),
      )
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (err) {
      console.error(`[${url.pathname}]`, err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message || 'Server error' }))
    }
    return
  }

  // Static files, falling back to index.html for the SPA.
  const path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, path)
  if (!existsSync(file) || path === '/') file = join(DIST, 'index.html')

  try {
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(PORT, () => {
  if (!process.env.YOUCAM_API_KEY) {
    console.warn('\n  ⚠  YOUCAM_API_KEY is not set. Copy .env.example to .env and add your key.\n')
  }
  console.log(`  ➜  http://localhost:${PORT}\n`)
})
