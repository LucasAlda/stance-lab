import { corners, G, type Config, type Corners, type Sample, type SourceReading } from '../shared/protocol.ts'

export function metrics(reading: SourceReading, config: Config, seq: number, t: number, receivedAtMonoMs: number, timestampSource: Sample['timestampSource'] = 'host-receive'): Sample {
  const forcesN = Object.fromEntries(corners.map(k => [k, (reading.kg[k] - config.tareKg[k]) * G])) as Corners
  const total = corners.reduce((sum, k) => sum + forcesN[k], 0)
  const loaded = total >= 30 && corners.every(k => forcesN[k] > -5)
  const x = loaded ? (forcesN.tr + forcesN.br - forcesN.tl - forcesN.bl) / total : 0
  const y = loaded ? (forcesN.tl + forcesN.tr - forcesN.bl - forcesN.br) / total : 0
  return {
    seq, t, receivedAtMonoMs, capturedAtMonoMs: reading.capturedAtMonoMs,
    boardId: reading.boardId, sourceStreamId: reading.streamId, timestampSource,
    raw: reading.raw, kg: reading.kg, forcesN,
    totalForceN: total, massEquivalentKg: total / G,
    bodyWeightPct: total / (config.bodyMassKg * G) * 100,
    cop: loaded ? { x, y, xMm: config.geometryVerified ? x * config.sensorWidthMm / 2 : null, yMm: config.geometryVerified ? y * config.sensorDepthMm / 2 : null } : null,
  }
}
