import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const directory = await mkdtemp(join(tmpdir(), 'stance-production-'))
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SOURCE: 'simulator', DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'inherit'],
})
let socket
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Production server did not start')), 10000)
    child.stdout.on('data', chunk => {
      const match = /http:\/\/localhost:\d+/.exec(chunk.toString())
      if (match) { clearTimeout(timer); resolve(match[0]) }
    })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)) })
  })
  const response = await fetch(base)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.ok(html.includes('Cada apoyo cuenta.'))
  const css = html.match(/href="(\/assets\/styles-[^"]+\.css)"/)
  assert.ok(css, 'SSR must link the built CSS')
  assert.equal((await fetch(`${base}${css[1]}`)).status, 200)
  const status = await fetch(`${base}/api/status`).then(r => r.json())
  assert.equal(status.source, 'simulator')
  socket = new WebSocket(`${base.replace('http:', 'ws:')}/stream`, { origin: base })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No production WebSocket batch')), 3000)
    socket.on('message', data => {
      if (JSON.parse(data.toString()).type === 'batch') { clearTimeout(timer); resolve() }
    })
    socket.on('error', reject)
  })
  console.log('Production smoke passed: SSR, built CSS, API and WebSocket on one port.')
} finally {
  socket?.terminate()
  child.kill('SIGTERM')
  if (child.exitCode === null) await once(child, 'exit')
  await rm(directory, { recursive: true, force: true })
}
