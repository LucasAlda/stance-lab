import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { sourceSchema, type SourceReading, type SourceMode } from '../shared/protocol.ts'

type Sink = (reading: SourceReading) => void
type State = (connected: boolean, message: string) => void

export function decodeToolkitPacket(packet: Buffer, streamId: string): SourceReading {
  if (packet.length !== 40) throw new Error('El paquete TCP debe tener 40 bytes')
  return sourceSchema.parse({
    boardId: packet.readBigUInt64BE(8).toString(16).padStart(12, '0'), streamId,
    capturedAtMonoMs: Number(packet.readBigInt64BE(0)) / 1000,
    kg: { tr: packet.readFloatBE(16), br: packet.readFloatBE(20), tl: packet.readFloatBE(24), bl: packet.readFloatBE(28) },
    raw: null, batteryPercent: null,
  })
}

export function startSource(mode: SourceMode, sink: Sink, state: State): () => void {
  let stopped = false
  let cleanup: () => void = () => {}
  let retry: ReturnType<typeof setTimeout> | undefined
  const reconnect = (start: () => void) => { if (!stopped) retry = setTimeout(start, 2000) }
  if (mode === 'simulator') {
    const started = performance.now()
    const streamId = randomUUID()
    state(true, 'Simulación · ciclo sintético de 8 segundos')
    const timer = setInterval(() => {
      const t = (performance.now() - started) / 1000
      const phase = t % 8
      const pulse = (center: number, width: number) => Math.exp(-(((phase - center) / width) ** 2))
      const total = 75 * (1 + 0.27 * pulse(4.4, 0.3) - 0.14 * pulse(3.8, 0.35))
      const x = 0.04 + 0.3 * pulse(2.9, 0.9) - 0.52 * pulse(4.7, 0.7)
      const y = 0.08 * Math.sin(t * 2)
      const kg = { tl: total * (1-x)*(1+y)/4, tr: total*(1+x)*(1+y)/4, bl: total*(1-x)*(1-y)/4, br: total*(1+x)*(1-y)/4 }
      sink({ boardId: 'SIM-WBB-01', streamId, capturedAtMonoMs: performance.now(), kg, raw: null, batteryPercent: null, discarded: 0 })
    }, 10)
    cleanup = () => clearInterval(timer)
  } else if (mode === 'wii') {
    const start = () => {
      state(false, 'Esperando tabla · presioná SYNC en el compartimento de pilas')
      const child = spawn(process.env.PYTHON_BIN || '.venv/bin/python', ['-u', 'python/bridge.py'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      const lines = createInterface({ input: child.stdout })
      lines.on('line', line => {
        try {
          const value = JSON.parse(line)
          if (value.type === 'status') { state(false, value.message); return }
          const parsed = sourceSchema.safeParse(value)
          if (parsed.success) sink(parsed.data)
          else state(false, 'Lectura inválida recibida del puente Python')
        } catch { state(false, 'Respuesta inválida del puente Python') }
      })
      child.stderr.on('data', chunk => console.error('[wii]', chunk.toString().trim()))
      child.on('error', err => state(false, `No se pudo iniciar Python: ${err.message}`))
      child.on('close', () => { state(false, 'Puente desconectado · reintentando'); reconnect(start) })
      cleanup = () => { lines.close(); child.kill('SIGTERM') }
    }
    start()
  } else {
    const start = () => {
      const streamId = randomUUID()
      let buffer = Buffer.alloc(0)
      let selectedBoard = process.env.TOOLKIT_BOARD_ID?.toLowerCase().replaceAll(':', '')
      const socket = createConnection({ host: process.env.TOOLKIT_HOST || 'localhost', port: Number(process.env.TOOLKIT_PORT || 11223) })
      state(false, 'Conectando a The Balance Toolkit · habilitá TCP y grabación')
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
        while (buffer.length >= 40) {
          const packet = buffer.subarray(0, 40)
          buffer = buffer.subarray(40)
          try {
            const reading = decodeToolkitPacket(packet, streamId)
            selectedBoard ??= reading.boardId
            // A platform cannot silently combine samples from two different boards.
            if (reading.boardId === selectedBoard) sink(reading)
          } catch { state(false, 'Paquete Toolkit inválido · verificá el puerto raw 11223') }
        }
      })
      socket.on('error', err => state(false, `Toolkit: ${err.message}`))
      socket.on('close', () => { state(false, 'Toolkit desconectado · reintentando'); reconnect(start) })
      cleanup = () => socket.destroy()
    }
    start()
  }
  return () => { stopped = true; clearTimeout(retry); cleanup() }
}
