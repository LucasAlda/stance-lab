import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Controller, toCsv } from '../server/controller.ts'
import type { SourceReading } from '../shared/protocol.ts'

const reading = (t: number, kg = 20, streamId = 'one'): SourceReading => ({ boardId: 'board', streamId, capturedAtMonoMs: t, kg: { tl: kg, tr: kg, bl: kg, br: kg }, raw: { tl: 1, tr: 2, bl: 3, br: 4 }, batteryPercent: 75, discarded: 0 })
async function fixture(mode: 'simulator' | 'wii', run: (c: Controller) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'stance-test-'))
  try { const c = new Controller(mode, dir); await c.init(); await run(c) }
  finally { await rm(dir, { recursive: true, force: true }) }
}
test('recordings persist all samples, source, calibration, and relative CSV times', () => fixture('simulator', async c => {
  c.ingest(reading(100))
  const id = c.startRecording()
  c.ingest(reading(110)); c.ingest(reading(120))
  await c.finish()
  const saved = await c.get(id)
  assert.equal(saved.count, 2)
  assert.equal(saved.source, 'simulator')
  assert.equal(saved.config.bodyMassKg, 75)
  assert.equal((await c.list()).length, 1)
  assert.equal(toCsv(saved).split('\n')[1].split(',')[1], '0')
  assert.ok(Math.abs(saved.duration - .01) < 1e-10)
  assert.equal(saved.samples[0].raw?.tl, 1)
}))
test('duplicate timestamps are rejected while equal force readings are retained', () => fixture('wii', async c => {
  c.ingest(reading(100)); c.ingest(reading(100)); c.ingest(reading(110))
  assert.equal(c.history.length, 2)
  assert.equal(c.status().rejected, 1)
}))
test('configuration cannot change during a recording', () => fixture('wii', async c => {
  c.ingest(reading(100)); c.startRecording()
  await assert.rejects(c.saveConfig({ ...c.config, bodyMassKg: 90 }), /grabación/)
}))
test('empty-board and stable-window checks guard tare', () => fixture('wii', async c => {
  // Use a source clock spanning a second, then populate enough stable reports.
  for (let i = 0; i <= 100; i++) c.ingest(reading(i * 10))
  await assert.rejects(c.tare(), /vacía/)
  c.history = []
  for (let i = 101; i <= 201; i++) c.ingest(reading(i * 10, .1))
  await c.tare()
  assert.ok(Math.abs(c.config.tareKg.tl - .1) < 1e-12)
  c.ingest(reading(2020, .1))
  assert.ok(Math.abs(c.history.at(-1)!.sample.totalForceN) < 1e-10)
}))
test('recordings cannot start without a live source and path traversal is rejected', () => fixture('wii', async c => {
  assert.throws(() => c.startRecording(), /fuente/)
  await assert.rejects(c.get('../../config'), /inválido/)
}))
test('a stalled source becomes disconnected and cannot start a new recording', () => fixture('wii', async c => {
  c.ingest(reading(100))
  assert.equal(c.status().connected, true)
  await new Promise(resolve => setTimeout(resolve, 550))
  assert.equal(c.status().connected, false)
  assert.equal(c.status().rateHz, 0)
  assert.throws(() => c.startRecording(), /fuente/)
}))
