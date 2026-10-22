import { useState } from 'react'
import type { Sample } from '../../shared/protocol'

export function ForceChart({ samples, replay }: { samples: Sample[]; replay: boolean }) {
  const [mode, setMode] = useState<'force' | 'cop'>('force')
  const latest = samples.at(-1)?.t ?? 0
  const start = Math.max(0, latest - 8)
  const visible = samples.filter(s => s.t >= start)
  const min = mode === 'force' ? 0 : -100
  const max = mode === 'force' ? Math.max(150, Math.ceil(Math.max(...visible.map(s => s.bodyWeightPct), 0) / 50) * 50) : 100
  const x = (t: number) => 58 + (t - start) / 8 * 922
  const y = (value: number) => 200 - (value - min) / (max - min) * 168
  const path = (key: 'force' | 'x' | 'y') => visible.reduce((result, sample, i) => {
    const value = key === 'force' ? sample.bodyWeightPct : sample.cop ? sample.cop[key] * 100 : null
    if (value === null) return { d: result.d, drawing: false }
    return { d: `${result.d}${result.drawing && i ? 'L' : 'M'}${x(sample.t).toFixed(2)},${y(value).toFixed(2)} `, drawing: true }
  }, { d: '', drawing: false }).d
  return <section className="panel chart-panel">
    <div className="panel-heading"><div><p className="eyebrow">La evolución de tu apoyo</p><h2>{mode === 'force' ? 'Fuerza vertical' : 'Centro de presión'}</h2></div>
      <div className="segments" aria-label="Métrica del gráfico"><button type="button" aria-pressed={mode === 'force'} onClick={() => setMode('force')}>Fuerza</button><button type="button" aria-pressed={mode === 'cop'} onClick={() => setMode('cop')}>CoP</button></div>
    </div>
    <div className="chart-legend"><span className="legend-dot" />{mode === 'force' ? 'Carga total · % del peso corporal' : 'Eje X · % del semieje'}{mode === 'cop' && <><span className="legend-dot second" />Eje Y</>}<span className="chart-window">{replay ? 'Reproducción' : 'Ventana de 8 s'}</span></div>
    <svg viewBox="0 0 1000 238" className="force-chart" role="img" aria-label={mode === 'force' ? 'Gráfico temporal de fuerza vertical, en porcentaje del peso corporal.' : 'Gráfico temporal del centro de presión en los ejes X e Y.'}>
      {[0, 1, 2, 3, 4].map(i => {
        const value = min + (max - min) * i / 4
        return <g key={i}><line x1="58" x2="980" y1={y(value)} y2={y(value)} className="chart-grid" /><text x="43" y={y(value) + 4} textAnchor="end" className="tick">{Math.round(value)}</text></g>
      })}
      {[0, 2, 4, 6, 8].map(i => <text key={i} x={58 + i / 8 * 922} y="226" textAnchor="middle" className="tick">{i === 8 ? 'ahora' : `−${8 - i} s`}</text>)}
      {mode === 'force' && <line x1="58" x2="980" y1={y(100)} y2={y(100)} className="reference-line" />}
      <path d={path(mode === 'force' ? 'force' : 'x')} className="chart-series" />
      {mode === 'cop' && <path d={path('y')} className="chart-series second" />}
      {!visible.length && <text x="500" y="115" textAnchor="middle" className="tick">Las muestras aparecerán al conectar una fuente.</text>}
    </svg>
  </section>
}
