import express from 'express'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { z } from 'zod'
import { Controller, toCsv } from './controller.ts'
import { startSource } from './sources.ts'
import { configSchema, type SourceMode } from '../shared/protocol.ts'

const production = process.argv.includes('--production')
const mode = z.enum(['simulator', 'wii', 'toolkit']).parse(process.env.SOURCE || 'simulator') as SourceMode
const port = Number(process.env.PORT || (production ? 3000 : 8787))
const controller = new Controller(mode, resolve(process.env.DATA_DIR || 'data'))
await controller.init()
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '16kb' }))
// The service is intended for a trusted LAN. Reject cross-origin browser writes.
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) { res.status(403).json({ error: 'Origen no permitido' }); return }
  next()
})
app.get('/api/status', (_req, res) => res.json(controller.status()))
app.put('/api/config', async (req, res) => {
  // Tare can only be changed through the guarded empty-board operation.
  const patch = configSchema.omit({ tareKg: true }).partial().strict().parse(req.body)
  await controller.saveConfig({ ...controller.config, ...patch })
  res.json(controller.config)
})
app.post('/api/tare', async (_req, res) => { await controller.tare(); res.json({ ok: true }) })
app.post('/api/reference', async (_req, res) => { await controller.reference(); res.json({ ok: true }) })
app.get('/api/recordings', async (_req, res) => res.json(await controller.list()))
app.post('/api/recordings/start', (_req, res) => res.json({ id: controller.startRecording() }))
app.post('/api/recordings/stop', async (_req, res) => res.json(await controller.finish()))
app.get('/api/recordings/:id/csv', async (req, res) => {
  const record = await controller.get(req.params.id)
  res.type('text/csv').attachment(`stance-${record.id}.csv`).send(toCsv(record))
})
app.get('/api/recordings/:id', async (req, res) => res.json(await controller.get(req.params.id)))
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Endpoint desconocido' }) })
app.use((err: Error & { code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const code = err.code === 'ENOENT' ? 404 : err instanceof z.ZodError ? 400 : 409
  res.status(code).json({ error: err instanceof z.ZodError ? 'Configuración inválida' : err.message })
})

if (production) {
  app.use(express.static(resolve('dist/client')))
  const { default: entry } = await import(pathToFileURL(resolve('dist/server/server.js')).href)
  app.use(async (req, res, next) => {
    try {
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value)
      const response = await entry.fetch(new Request(`http://${req.headers.host}${req.originalUrl}`, { headers, method: req.method }))
      res.status(response.status)
      response.headers.forEach((value: string, key: string) => res.setHeader(key, value))
      res.send(Buffer.from(await response.arrayBuffer()))
    } catch (err) { next(err) }
  })
}
const http = createServer(app)
const ws = new WebSocketServer({ server: http, path: '/stream' })
ws.on('connection', (client, req) => {
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { client.close(1008, 'Origen no permitido'); return }
  client.send(JSON.stringify({ type: 'status', status: controller.status() }))
})
function broadcast(value: unknown) {
  const data = JSON.stringify(value)
  for (const client of ws.clients) if (client.readyState === WebSocket.OPEN) {
    if (client.bufferedAmount > 1_000_000) client.close(1013, 'Cliente lento; reconectar')
    else client.send(data)
  }
}
const batchTimer = setInterval(() => { if (controller.pending.length) broadcast({ type: 'batch', samples: controller.pending.splice(0) }) }, 1000 / 30)
const statusTimer = setInterval(() => broadcast({ type: 'status', status: controller.status() }), 250)
const stopSource = startSource(mode, reading => controller.ingest(reading), (_connected, message) => { controller.message = message })
http.listen(port, process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'), () => {
  const address = http.address()
  console.log(`Stance Lab · ${mode} · http://localhost:${typeof address === 'object' && address ? address.port : port}`)
})
let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  stopSource(); clearInterval(batchTimer); clearInterval(statusTimer)
  if (controller.recording?.samples.length) await controller.finish().catch(err => console.error('Error al guardar grabación:', err))
  for (const client of ws.clients) client.terminate()
  ws.close(); http.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
