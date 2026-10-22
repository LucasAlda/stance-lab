import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultConfig, G, type SourceReading } from '../shared/protocol.ts'
import { metrics } from '../server/metrics.ts'
import { decodeToolkitPacket } from '../server/sources.ts'

const reading = (kg: SourceReading['kg']): SourceReading => ({ boardId: 'test', streamId: 'test-stream', capturedAtMonoMs: 100, kg, raw: null, batteryPercent: null, discarded: 0 })

test('an even 80 kg load has 784.532 N and a centered CoP', () => {
  const result = metrics(reading({ tl: 20, tr: 20, bl: 20, br: 20 }), { ...defaultConfig, bodyMassKg: 80 }, 1, 0, 0)
  assert.equal(result.totalForceN, 80 * G)
  assert.equal(result.bodyWeightPct, 100)
  assert.deepEqual(result.cop, { x: 0, y: 0, xMm: null, yMm: null })
})
test('the top right corner is +X, +Y using measured sensor coordinates', () => {
  const result = metrics(reading({ tl: 0, tr: 20, bl: 0, br: 0 }), { ...defaultConfig, geometryVerified: true, sensorWidthMm: 400, sensorDepthMm: 200 }, 1, 0, 0)
  assert.deepEqual(result.cop, { x: 1, y: 1, xMm: 200, yMm: 100 })
})
test('an unloaded board has no CoP, including after tare subtraction', () => {
  const result = metrics(reading({ tl: 0.1, tr: 0.1, bl: 0.1, br: 0.1 }), { ...defaultConfig, tareKg: { tl: 0.1, tr: 0.1, bl: 0.1, br: 0.1 } }, 1, 0, 0)
  assert.equal(result.totalForceN, 0)
  assert.equal(result.cop, null)
})
test('a significantly negative sensor invalidates CoP rather than faking a position', () => {
  assert.equal(metrics(reading({ tl: -5, tr: 30, bl: 20, br: 20 }), defaultConfig, 1, 0, 0).cop, null)
})
test('Toolkit big-endian packet keeps sensor order and timestamp units', () => {
  const packet = Buffer.alloc(40)
  packet.writeBigInt64BE(1_000_000n, 0)
  packet.writeBigUInt64BE(0xaabbccddeeffn, 8)
  ;[10, 20, 30, 40, 0, 0].forEach((v, i) => packet.writeFloatBE(v, 16 + i * 4))
  const result = decodeToolkitPacket(packet, 'stream')
  assert.equal(result.capturedAtMonoMs, 1000)
  assert.equal(result.boardId, 'aabbccddeeff')
  assert.deepEqual(result.kg, { tr: 10, br: 20, tl: 30, bl: 40 })
  assert.equal(result.raw, null)
})
test('Toolkit rejects non-finite values and malformed frames', () => {
  assert.throws(() => decodeToolkitPacket(Buffer.alloc(39), 'stream'))
  const packet = Buffer.alloc(40)
  packet.writeFloatBE(NaN, 16)
  assert.throws(() => decodeToolkitPacket(packet, 'stream'))
})
