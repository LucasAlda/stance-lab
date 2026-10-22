import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { WebSocket } from 'ws'
import { startSource } from '../server/sources.ts'
import type { Recording, Status } from '../shared/protocol.ts'

test('HTTP + WebSocket: receive, record, persist, export and reject invalid writes', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stance-service-'))
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: '0', SOURCE: 'simulator', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
  let socket: WebSocket | undefined
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('El servicio no inició')), 8000)
      child.stdout.on('data', chunk => { const match = /http:\/\/localhost:\d+/.exec(chunk.toString()); if (match) { clearTimeout(timer); resolve(match[0]) } })
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`El servicio terminó: ${code}`)) })
    })
    const status = await fetch(`${base}/api/status`).then(r => r.json()) as Status
    assert.equal(status.source, 'simulator')
    socket = new WebSocket(`${base.replace('http:', 'ws:')}/stream`, { origin: base })
    await once(socket, 'open')
    const batch = () => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sin batch WebSocket')), 2000)
      const listener = (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'batch') { clearTimeout(timer); socket!.off('message', listener); resolve() }
      }
      socket!.on('message', listener)
    })
    await batch()
    const post = (path: string) => fetch(`${base}/api${path}`, { method: 'POST', headers: { Origin: base } })
    const start = await post('/recordings/start')
    assert.equal(start.status, 200)
    const { id } = await start.json()
    await batch(); await batch()
    const stop = await post('/recordings/stop')
    assert.equal(stop.status, 200)
    const record = await fetch(`${base}/api/recordings/${id}`).then(r => r.json()) as Recording
    assert.ok(record.count > 0)
    assert.equal(record.samples.length, record.count)
    assert.equal(record.source, 'simulator')
    const csv = await fetch(`${base}/api/recordings/${id}/csv`).then(r => r.text())
    assert.equal(csv.trim().split('\n').length, record.count + 1)
    assert.equal((await fetch(`${base}/api/recordings`).then(r => r.json())).length, 1)
    const bad = await fetch(`${base}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ bodyMassKg: -10 }) })
    assert.equal(bad.status, 400)
    const wrongOrigin = await fetch(`${base}/api/recordings/start`, { method: 'POST', headers: { Origin: 'https://unrelated.example' } })
    assert.equal(wrongOrigin.status, 403)
  } finally {
    socket?.terminate()
    child.kill('SIGTERM')
    if (child.exitCode === null) await once(child, 'exit')
    await rm(dir, { recursive: true, force: true })
  }
})

test('Toolkit adapter reassembles fragmented TCP frames and selects one board', { timeout: 5000 }, async () => {
  let client: import('node:net').Socket | undefined
  const server = createServer(socket => { client = socket })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as import('node:net').AddressInfo
  const previous = { host: process.env.TOOLKIT_HOST, port: process.env.TOOLKIT_PORT }
  process.env.TOOLKIT_HOST = '127.0.0.1'; process.env.TOOLKIT_PORT = String(address.port)
  const received: string[] = []
  const first = Buffer.alloc(40)
  first.writeBigInt64BE(100000n, 0); first.writeBigUInt64BE(1n, 8)
  const second = Buffer.from(first); second.writeBigUInt64BE(2n, 8)
  let stop = () => {}
  try {
    const result = new Promise<void>(resolve => { stop = startSource('toolkit', sample => { received.push(sample.boardId); resolve() }, () => {}) })
    await once(server, 'connection')
    client!.write(first.subarray(0, 7))
    client!.write(Buffer.concat([first.subarray(7), second]))
    await result
    assert.deepEqual(received, ['000000000001'])
  } finally {
    stop(); client?.destroy(); server.close()
    if (previous.host === undefined) delete process.env.TOOLKIT_HOST; else process.env.TOOLKIT_HOST = previous.host
    if (previous.port === undefined) delete process.env.TOOLKIT_PORT; else process.env.TOOLKIT_PORT = previous.port
  }
})
