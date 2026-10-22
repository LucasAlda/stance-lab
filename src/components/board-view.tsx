import type { Sample } from '../../shared/protocol'

const number = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 })

export function BoardView({ sample, samples, active }: { sample: Sample | null; samples: Sample[]; active: boolean }) {
  const cop = active ? sample?.cop : null
  const points = samples.filter(s => s.cop && sample && sample.t - s.t < 2).map(s => `${270 + s.cop!.x * 196},${164 - s.cop!.y * 100}`).join(' ')
  return <svg className="board-svg" viewBox="0 0 540 330" role="img" aria-label={cop ? `Centro de presión: x ${number(cop.x * 100)}%, y ${number(cop.y * 100)}% del semieje.` : 'Tabla sin centro de presión disponible.'}>
    <defs>
      <pattern id="board-grid" width="24.5" height="25" patternUnits="userSpaceOnUse"><path d="M 24.5 0 L 0 0 0 25" className="grid-line" fill="none" /></pattern>
    </defs>
    <text x="270" y="24" textAnchor="middle" className="board-label">BORDE SUPERIOR · +Y</text>
    <rect x="48" y="42" width="444" height="244" rx="32" className="board-shell" />
    <rect x="74" y="64" width="392" height="200" rx="16" className="board-surface" />
    <rect x="74" y="64" width="392" height="200" rx="16" fill="url(#board-grid)" />
    <path d="M270 64 V264 M74 164 H466" className="board-axis" />
    <text x="85" y="169" className="axis-label">−X</text><text x="442" y="169" className="axis-label">+X</text>
    {(['tl', 'tr', 'bl', 'br'] as const).map((key, i) => {
      const x = i % 2 === 0 ? 83 : 457
      const y = i < 2 ? 73 : 255
      return <g key={key}><circle cx={x} cy={y} r="6" className="support-dot" /><text x={x + (i % 2 === 0 ? 14 : -14)} y={y + (i < 2 ? 5 : 5)} textAnchor={i % 2 === 0 ? 'start' : 'end'} className="support-value">{active && sample ? `${number(sample.forcesN[key])} N` : '—'}</text></g>
    })}
    {active && points && <polyline points={points} className="cop-trail" />}
    {cop && <g><circle cx={270 + cop.x * 196} cy={164 - cop.y * 100} r="17" className="cop-halo" /><circle cx={270 + cop.x * 196} cy={164 - cop.y * 100} r="7" className="cop-dot" /></g>}
    {!cop && <text x="270" y="170" textAnchor="middle" className="board-empty">{active ? 'Sin carga suficiente' : 'Esperando señal'}</text>}
    <text x="270" y="315" textAnchor="middle" className="board-label">BORDE INFERIOR · −Y</text>
  </svg>
}
