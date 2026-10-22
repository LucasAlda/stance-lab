import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configSchema, defaultConfig, G, corners, type Config, type Recording, type RecordingMeta, type Sample, type SourceMode, type SourceReading, type Status } from '../shared/protocol.ts'
import { metrics } from './metrics.ts'

export class Controller {
  config: Config = structuredClone(defaultConfig)
  history: { reading: SourceReading; sample: Sample }[] = []
  pending: Sample[] = []
  recording: Recording | null = null
  message = 'Iniciando fuente'
  rejected = 0
  private seq = 0
  private started = performance.now()
  private lastArrival: number | null = null
  private arrivals: number[] = []
  private activeStream = ''
  private sourceAnchor = 0
  private hostAnchor = 0
  private lastCaptured = -Infinity
  private finishing = false
  private savingConfig = false

  constructor(public mode: SourceMode, public directory: string) {}

  async init() {
    await mkdir(this.directory, { recursive: true })
    try { this.config = configSchema.parse(JSON.parse(await readFile(join(this.directory, 'config.json'), 'utf8'))) }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('La configuración guardada es inválida; revisá data/config.json', { cause: err })
    }
  }

  async saveConfig(config: Config) {
    if (this.recording || this.finishing) throw new Error('Terminá la grabación antes de cambiar la calibración')
    if (this.savingConfig) throw new Error('Ya se está guardando la configuración')
    const parsed = configSchema.parse(config)
    this.savingConfig = true
    try {
      await writeFile(join(this.directory, 'config.json.tmp'), JSON.stringify(parsed, null, 2))
      await rename(join(this.directory, 'config.json.tmp'), join(this.directory, 'config.json'))
      this.config = parsed
      // Do not blend pre- and post-calibration values in calibration windows.
      this.history = []
      this.pending = []
    } finally { this.savingConfig = false }
  }

  ingest(reading: SourceReading) {
    const now = performance.now()
    const stream = `${reading.boardId}/${reading.streamId}`
    if (stream !== this.activeStream) {
      this.activeStream = stream
      this.sourceAnchor = reading.capturedAtMonoMs
      this.hostAnchor = (now - this.started) / 1000
      this.lastCaptured = -Infinity
      this.history = []
      this.arrivals = []
    }
    if (reading.capturedAtMonoMs <= this.lastCaptured || corners.some(k => Math.abs(reading.kg[k]) > 250)) { this.rejected++; return }
    this.lastCaptured = reading.capturedAtMonoMs
    const t = this.hostAnchor + (reading.capturedAtMonoMs - this.sourceAnchor) / 1000
    const sample = metrics(reading, this.config, ++this.seq, t, now, this.mode === 'toolkit' ? 'toolkit' : 'host-receive')
    this.lastArrival = now
    this.arrivals.push(now)
    this.arrivals = this.arrivals.filter(value => now - value <= 2000)
    this.history.push({ reading, sample })
    this.history = this.history.filter(value => now - value.sample.receivedAtMonoMs <= 2000)
    this.pending.push(sample)
    if (this.pending.length > 512) this.pending.shift()
    if (this.recording) {
      if (sample.sourceStreamId !== this.recording.samples[0]?.sourceStreamId && this.recording.samples.length) {
        void this.finish().catch(err => { this.message = `Error al guardar: ${err.message}` })
        this.message = 'La fuente se reconectó · grabación finalizada'
        return
      }
      this.recording.samples.push(sample)
      if (sample.t - this.recording.samples[0].t >= 60 || this.recording.samples.length >= 12000) {
        void this.finish().catch(err => { this.message = `Error al guardar: ${err.message}` })
      }
    }
  }

  status(): Status {
    const now = performance.now()
    const age = this.lastArrival === null ? null : now - this.lastArrival
    const connected = age !== null && age < 500
    const arrivals = this.arrivals.filter(t => now - t < 2000)
    const rate = connected && arrivals.length > 1 ? (arrivals.length - 1) * 1000 / (arrivals.at(-1)! - arrivals[0]) : 0
    const latest = this.history.at(-1)?.reading
    return {
      source: this.mode, connected, message: connected ? this.mode === 'simulator' ? 'Datos simulados · sin tabla conectada' : 'Recibiendo muestras' : this.message,
      rateHz: Math.round(rate * 10) / 10, lastSampleAgeMs: age,
      sourceDiscarded: latest?.discarded ?? 0, rejected: this.rejected,
      batteryPercent: latest?.batteryPercent ?? null, config: this.config,
      recording: this.recording ? { id: this.recording.id, samples: this.recording.samples.length, duration: this.recording.samples.length > 1 ? this.recording.samples.at(-1)!.t - this.recording.samples[0].t : 0 } : null,
    }
  }

  private calibrationWindow() {
    if (!this.status().connected) throw new Error('La fuente no está recibiendo datos')
    const recent = this.history.filter(item => performance.now() - item.sample.receivedAtMonoMs < 1200)
    if (recent.length < 20 || recent.at(-1)!.sample.t - recent[0].sample.t < 0.8) throw new Error('Esperá al menos un segundo de lecturas estables')
    const mean = recent.reduce((s, x) => s + x.sample.totalForceN, 0) / recent.length
    const std = Math.sqrt(recent.reduce((s, x) => s + (x.sample.totalForceN - mean) ** 2, 0) / recent.length)
    if (std > Math.max(3, Math.abs(mean) * 0.015)) throw new Error('Las lecturas están variando; mantené la carga quieta')
    return { recent, mean }
  }

  async tare() {
    if (this.mode === 'simulator') throw new Error('La simulación representa una tabla cargada; tara disponible con hardware')
    const { recent, mean } = this.calibrationWindow()
    if (Math.abs(mean) > 50) throw new Error('Bajate de la tabla: la tara requiere la superficie vacía')
    const tareKg = { tl: 0, tr: 0, bl: 0, br: 0 }
    for (const k of corners) tareKg[k] = recent.reduce((s, r) => s + r.reading.kg[k], 0) / recent.length
    await this.saveConfig({ ...this.config, tareKg })
  }

  async reference() {
    const { mean } = this.calibrationWindow()
    if (mean < 100) throw new Error('Subite a la tabla y mantenete quieto para tomar la referencia')
    await this.saveConfig({ ...this.config, bodyMassKg: mean / G })
  }

  startRecording() {
    if (this.recording || this.finishing) throw new Error('Ya hay una grabación en curso')
    if (!this.status().connected || !this.history.length || this.savingConfig) throw new Error('No hay una fuente activa para grabar')
    this.recording = {
      version: 1, id: randomUUID(), createdAt: new Date().toISOString(), source: this.mode,
      boardId: this.history.at(-1)!.reading.boardId, duration: 0, count: 0, peakForceN: 0,
      config: structuredClone(this.config), samples: [],
    }
    return this.recording.id
  }

  async finish(): Promise<RecordingMeta> {
    if (!this.recording || this.finishing) throw new Error('No hay una grabación para detener')
    const record = this.recording
    if (!record.samples.length) throw new Error('Esperá una muestra antes de detener')
    this.finishing = true
    this.recording = null
    record.count = record.samples.length
    record.duration = record.samples.at(-1)!.t - record.samples[0].t
    record.peakForceN = Math.max(...record.samples.map(s => s.totalForceN))
    try {
      await writeFile(join(this.directory, `${record.id}.json.tmp`), JSON.stringify(record))
      await rename(join(this.directory, `${record.id}.json.tmp`), join(this.directory, `${record.id}.json`))
      const { samples: _, ...meta } = record
      return meta
    } catch (err) {
      this.recording = record
      throw err
    } finally { this.finishing = false }
  }

  async list(): Promise<RecordingMeta[]> {
    const files = (await readdir(this.directory)).filter(f => /^[0-9a-f-]{36}\.json$/.test(f))
    const records = await Promise.all(files.map(f => this.get(f.slice(0, -5))))
    return records.map(({ samples: _, ...meta }) => meta).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async get(id: string): Promise<Recording> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('ID de grabación inválido')
    return JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8'))
  }
}

export function toCsv(record: Recording) {
  const header = 'seq,time_s,source_capture_ms,source_stream,force_n,kg_equivalent,body_weight_pct,cop_x_normalized,cop_y_normalized,cop_x_mm,cop_y_mm,tl_n,tr_n,bl_n,br_n,raw_tl,raw_tr,raw_bl,raw_br'
  return [header, ...record.samples.map(s => [s.seq, s.t - record.samples[0].t, s.capturedAtMonoMs, s.sourceStreamId, s.totalForceN, s.massEquivalentKg, s.bodyWeightPct, s.cop?.x, s.cop?.y, s.cop?.xMm, s.cop?.yMm, ...corners.map(k => s.forcesN[k]), ...corners.map(k => s.raw?.[k])].join(','))].join('\n') + '\n'
}
