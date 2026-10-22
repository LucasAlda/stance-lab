import { z } from 'zod'

export const G = 9.80665
export const corners = ['tl', 'tr', 'bl', 'br'] as const
export type Corner = typeof corners[number]
export type Corners = Record<Corner, number>
const values = z.object({ tl: z.number().finite(), tr: z.number().finite(), bl: z.number().finite(), br: z.number().finite() })
export const sourceSchema = z.object({
  boardId: z.string().min(1).max(100), streamId: z.string().min(1).max(100),
  capturedAtMonoMs: z.number().finite(), kg: values,
  raw: values.nullable(), batteryPercent: z.number().min(0).max(100).nullable(),
  discarded: z.number().int().nonnegative().default(0),
})
export type SourceReading = z.infer<typeof sourceSchema>
export const configSchema = z.object({
  bodyMassKg: z.number().min(10).max(200),
  sensorWidthMm: z.number().min(50).max(1000),
  sensorDepthMm: z.number().min(50).max(1000),
  geometryVerified: z.boolean(),
  tareKg: values,
})
export type Config = z.infer<typeof configSchema>
export const defaultConfig: Config = {
  bodyMassKg: 75, sensorWidthMm: 433, sensorDepthMm: 238,
  geometryVerified: false, tareKg: { tl: 0, tr: 0, bl: 0, br: 0 },
}
export type Sample = {
  seq: number; t: number; boardId: string; sourceStreamId: string;
  capturedAtMonoMs: number; receivedAtMonoMs: number;
  timestampSource: 'host-receive' | 'toolkit';
  raw: Corners | null; kg: Corners; forcesN: Corners;
  totalForceN: number; massEquivalentKg: number; bodyWeightPct: number;
  cop: { x: number; y: number; xMm: number | null; yMm: number | null } | null;
}
export type SourceMode = 'simulator' | 'wii' | 'toolkit'
export type Status = {
  source: SourceMode; connected: boolean; message: string; rateHz: number;
  lastSampleAgeMs: number | null; sourceDiscarded: number; rejected: number;
  batteryPercent: number | null; config: Config;
  recording: { id: string; samples: number; duration: number } | null;
}
export type RecordingMeta = {
  id: string; createdAt: string; source: SourceMode; boardId: string;
  duration: number; count: number; peakForceN: number; config: Config;
}
export type Recording = RecordingMeta & { version: 1; samples: Sample[] }
export type StreamMessage = { type: 'batch'; samples: Sample[] } | { type: 'status'; status: Status }
