import { useCallback, useEffect, useRef, useState } from 'react'
import type { Recording, RecordingMeta, Sample, Status, StreamMessage } from '../../shared/protocol'

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `Error ${response.status}`)
  return value
}

export function useBoard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [online, setOnline] = useState(false)
  const [recordings, setRecordings] = useState<RecordingMeta[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [replay, setReplay] = useState<Recording | null>(null)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const lastRecording = useRef<string | null>(null)
  const refresh = useCallback(() => api<RecordingMeta[]>('/recordings').then(setRecordings).catch(err => setError(err.message)), [])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout>
    function connect() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/stream`)
      socket.onopen = () => { setOnline(true); void refresh() }
      socket.onmessage = event => {
        const message = JSON.parse(event.data) as StreamMessage
        if (message.type === 'status') {
          setStatus(message.status)
          if (lastRecording.current && !message.status.recording) void refresh()
          lastRecording.current = message.status.recording?.id ?? null
        } else setSamples(previous => {
          const last = message.samples.at(-1)
          if (!last) return previous
          const combined = previous.at(-1)?.sourceStreamId === last.sourceStreamId ? [...previous, ...message.samples] : message.samples
          return combined.filter(s => last.t - s.t <= 10).slice(-2000)
        })
      }
      socket.onclose = () => { if (!disposed) { setOnline(false); retry = setTimeout(connect, 2000) } }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => { disposed = true; clearTimeout(retry); socket?.close() }
  }, [refresh])

  useEffect(() => {
    if (!playing || !replay) return
    const started = performance.now()
    const from = position
    const timer = setInterval(() => {
      const next = from + (performance.now() - started) / 1000
      if (next >= replay.duration) { setPosition(replay.duration); setPlaying(false) }
      else setPosition(next)
    }, 33)
    return () => clearInterval(timer)
    // Position is the playback origin; slider actions pause playback first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, replay])

  const run = async (action: () => Promise<unknown>, successMessage = '') => {
    setPending(true); setError(''); setNotice('')
    try { await action(); setNotice(successMessage) } catch (err) { setError((err as Error).message) }
    finally { setPending(false) }
  }
  const openReplay = (id: string) => run(async () => {
    const recording = await api<Recording>(`/recordings/${id}`)
    setPlaying(false); setPosition(0); setReplay(recording)
  })
  const closeReplay = () => { setPlaying(false); setReplay(null); setPosition(0) }
  const replayStart = replay?.samples[0]?.t ?? 0
  const visibleSamples = replay ? replay.samples.filter(s => s.t <= replayStart + position) : samples
  const current = visibleSamples.at(-1) ?? null

  return { status, samples: visibleSamples, current, online, recordings, error, setError, notice, setNotice, pending, run, refresh,
    replay, openReplay, closeReplay, position, setPosition, playing, setPlaying }
}
