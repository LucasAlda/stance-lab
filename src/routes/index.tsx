import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Circle, CircleDot, Menu, Pause, Play, Radio, Settings2, Square, X } from 'lucide-react'
import { BoardView } from '../components/board-view'
import { ForceChart } from '../components/force-chart'
import { api, useBoard } from '../lib/use-board'
import { corners, type Config } from '../../shared/protocol'

export const Route = createFileRoute('/')({ component: Dashboard })
const fmt = (value: number | null | undefined, digits = 1) => value == null ? '—' : value.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function Dashboard() {
  const board = useBoard()
  const { status, current, replay, recordings, pending, run } = board
  const [tab, setTab] = useState<'live' | 'sessions' | 'device'>('live')
  const [menu, setMenu] = useState(false)
  const active = !!replay || (board.online && !!status?.connected)
  const sourceName = status?.source === 'simulator' ? 'Simulador' : status?.source === 'wii' ? 'Wii Balance Board' : status?.source === 'toolkit' ? 'Balance Toolkit' : 'Conectando'
  const sample = active ? current : null
  const left = sample ? sample.forcesN.tl + sample.forcesN.bl : 0
  const right = sample ? sample.forcesN.tr + sample.forcesN.br : 0
  const leftPct = sample && sample.totalForceN > 30 ? Math.min(100, Math.max(0, left / sample.totalForceN * 100)) : 50
  const config = replay?.config ?? status?.config

  const navigation = <>{(['live', 'sessions', 'device'] as const).map((item, i) => <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => { setTab(item); setMenu(false) }}>{['En vivo', 'Sesiones', 'Dispositivo'][i]}{item === 'sessions' && recordings.length > 0 && <span className="nav-count">{recordings.length}</span>}</button>)}</>

  return <div className="app-shell">
    <header className="topbar"><div className="topbar-inner">
      <a href="/" className="brand" aria-label="Inicio de Stance Lab"><span className="brand-mark"><span /><span /></span>stance<span className="brand-light">lab</span><span className="brand-version">BETA</span></a>
      <nav aria-label="Navegación principal" className="desktop-nav">{navigation}</nav>
      <div className="connection-label"><span className={`status-dot ${board.online && status?.connected ? 'on' : ''}`} />{sourceName}</div>
      <button type="button" className="icon-button mobile-toggle" aria-label="Abrir navegación" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
    </div>{menu && <nav className="mobile-nav" aria-label="Navegación móvil">{navigation}</nav>}</header>

    <main>
      <div className="page-heading"><div><p className="eyebrow"><span className="tiny-line" /> Tu laboratorio de movimiento</p><h1>{tab === 'sessions' ? 'Volvé a cada swing.' : tab === 'device' ? 'Prepará tu medición.' : 'Cada apoyo cuenta.'}</h1><p className="page-description">{tab === 'sessions' ? 'Tus capturas, con todas las muestras y su calibración.' : tab === 'device' ? 'Una buena lectura empieza con una referencia estable.' : 'Explorá cómo cambia tu carga durante el swing.'}</p></div>
        {tab === 'live' && <div className="heading-actions">{replay ? <button type="button" className="button" onClick={board.closeReplay}><ArrowLeft size={16} /> Volver en vivo</button> : <><button type="button" className="button" onClick={() => setTab('device')}><Settings2 size={16} /> Calibración</button><button type="button" className={`button primary ${status?.recording ? 'recording' : ''}`} disabled={pending || !active} onClick={() => void run(async () => { await api(status?.recording ? '/recordings/stop' : '/recordings/start', 'POST'); await board.refresh() })}>{status?.recording ? <Square size={14} /> : <Circle size={14} />}{status?.recording ? `Detener · ${fmt(status.recording.duration)} s` : 'Grabar swing'}</button></>}</div>}
      </div>

      {board.error && <div className="notice error" role="alert"><span>{board.error}</span><button type="button" className="icon-button" aria-label="Cerrar aviso" onClick={() => board.setError('')}><X size={18} /></button></div>}
      {board.notice && <div className="notice success" role="status"><span>{board.notice}</span><button type="button" className="icon-button" aria-label="Cerrar confirmación" onClick={() => board.setNotice('')}><X size={18} /></button></div>}
      {!board.online && <div className="notice warning" role="status">Conectando con el servicio local. Se reintentará automáticamente.</div>}
      {board.online && (replay ? replay.source === 'simulator' : status?.source === 'simulator') && <div className="demo-notice"><div><CircleDot size={17} /><strong>Modo de demostración</strong><span>Estás viendo un swing sintético. No hay mediciones de una tabla real.</span></div><button type="button" onClick={() => setTab('device')}>Conectar mi tabla <ArrowUpRight size={15} /></button></div>}
      {board.online && !status?.connected && status?.source !== 'simulator' && <div className="notice warning" role="status">{status?.message || 'Esperando muestras de la tabla.'}</div>}

      {tab === 'live' && <>
        {replay && <div className="replay-bar"><button type="button" className="button" aria-label={board.playing ? 'Pausar reproducción' : 'Reproducir grabación'} onClick={() => { if (board.position >= replay.duration) board.setPosition(0); board.setPlaying(!board.playing) }}>{board.playing ? <Pause size={16} /> : <Play size={16} />}</button><div><strong>Reproducción {replay.source === 'simulator' ? '· simulada' : ''}</strong><p>{new Date(replay.createdAt).toLocaleString('es-AR')}</p></div><input name="replay-position" aria-label="Posición de reproducción" type="range" min="0" max={replay.duration || 0.01} step="0.01" value={board.position} onChange={e => { board.setPlaying(false); board.setPosition(Number(e.target.value)) }} /><output>{fmt(board.position)} / {fmt(replay.duration)} s</output></div>}
        <div className="metrics-wrapper"><dl className="metrics-grid">
          <Metric label="Fuerza vertical" value={fmt(sample?.totalForceN, 0)} unit="N" detail="Suma de los cuatro apoyos" />
          <Metric label="Carga equivalente" value={fmt(sample?.massEquivalentKg)} unit="kg" detail="Fuerza expresada como masa" />
          <Metric label="Respecto a tu peso" value={fmt(sample?.bodyWeightPct, 0)} unit="%BW" detail={`Referencia · ${fmt(config?.bodyMassKg)} kg`} accent />
          <Metric label={replay ? 'Muestras capturadas' : 'Frecuencia efectiva'} value={replay ? fmt(replay.count, 0) : fmt(status?.rateHz, 0)} unit={replay ? '' : 'Hz'} detail={replay ? `${fmt(replay.duration)} segundos de captura` : 'Reportes recibidos por segundo'} />
        </dl></div>

        <div className="measurement-grid">
          <section className="panel board-panel"><div className="panel-heading"><div><p className="eyebrow">Vista superior</p><h2>Tu centro de presión</h2></div><span className="subtle-badge"><span className={`status-dot ${active ? 'on' : ''}`} />{replay ? 'Replay' : active ? 'En vivo' : 'Sin señal'}</span></div>
            <BoardView sample={current} samples={board.samples} active={active} />
            <div className="cop-coordinates"><span><span className="legend-dot" />CoP · últimos 2 s</span><span>X <strong>{fmt(sample?.cop ? sample.cop.x * 100 : null, 0)}%</strong><span className="coordinate-divider" />Y <strong>{fmt(sample?.cop ? sample.cop.y * 100 : null, 0)}%</strong></span></div>
            <p className="panel-note">{sample?.cop?.xMm != null ? `X ${fmt(sample.cop.xMm)} mm · Y ${fmt(sample.cop.yMm)} mm · geometría verificada.` : 'Coordenadas relativas al semieje de la tabla. El CoP no es el centro de masa.'}</p>
          </section>

          <section className="panel distribution-panel"><div className="panel-heading"><div><p className="eyebrow">Una plataforma · cuatro apoyos</p><h2>Distribución de carga</h2></div><Radio size={19} className="muted-icon" /></div>
            <div className="balance-values"><div><p>Mitad izquierda</p><strong>{sample?.cop ? fmt(leftPct, 0) : '—'}<small>%</small></strong></div><div><p>Mitad derecha</p><strong>{sample?.cop ? fmt(100-leftPct, 0) : '—'}<small>%</small></strong></div></div>
            <div className="balance-track" role="img" aria-label={sample?.cop ? `Reacción de apoyos: izquierda ${fmt(leftPct, 0)}%, derecha ${fmt(100-leftPct, 0)}%.` : 'Sin distribución disponible'}><div style={{ width: `${leftPct}%` }} /><span /></div>
            <div className="support-list">{corners.map((k, i) => <div className="support-row" key={k}><span className="support-index">0{i+1}</span><span>{['Superior izquierdo', 'Superior derecho', 'Inferior izquierdo', 'Inferior derecho'][i]}</span><strong>{fmt(sample?.forcesN[k], 0)} <small>N</small></strong></div>)}</div>
            <p className="measurement-note"><strong>Carga por apoyo, no por pie.</strong> Una sola tabla no separa la fuerza de cada pie ni mide fuerzas horizontales.</p>
          </section>
        </div>
        <ForceChart samples={board.samples} replay={!!replay} />
        <div className="capture-footer"><span><span className="status-dot on" />{status?.recording ? `Grabando ${status.recording.samples} muestras · máximo 60 s` : 'Lista para capturar · hasta 60 s por grabación'}</span><button type="button" onClick={() => setTab('sessions')}>Ver sesiones guardadas <ArrowUpRight size={15} /></button></div>
      </>}

      {tab === 'sessions' && <section className="panel sessions-panel"><div className="panel-heading"><div><p className="eyebrow">Biblioteca local</p><h2>Sesiones guardadas</h2></div><span className="subtle-badge">{recordings.length} capturas</span></div>{!recordings.length ? <div className="empty-state"><CircleDot size={30} /><h3>Tu primer swing empieza acá.</h3><p>Grabá unos segundos desde En vivo. Después podrás reproducir cada muestra o descargar el CSV.</p><button type="button" className="button" onClick={() => setTab('live')}>Ir a En vivo <ArrowUpRight size={16} /></button></div> : <div className="recording-list">{recordings.map((r, i) => <article className="recording-row" key={r.id}><div className="session-number">{String(recordings.length-i).padStart(2, '0')}</div><div className="recording-title"><h3>{new Date(r.createdAt).toLocaleString('es-AR')}</h3><p>{r.source === 'simulator' ? 'Simulación' : r.source === 'wii' ? 'Wii Balance Board' : 'Balance Toolkit'} · {r.count} muestras</p></div><div className="recording-stat"><strong>{fmt(r.duration)} s</strong><p>Duración</p></div><div className="recording-stat"><strong>{fmt(r.peakForceN, 0)} N</strong><p>Pico vertical</p></div><div className="recording-actions"><button type="button" className="button" disabled={pending} onClick={() => void board.openReplay(r.id).then(() => setTab('live'))}><Play size={15} /> Reproducir</button><a className="button" href={`/api/recordings/${r.id}/csv`} download aria-label="Descargar CSV"><ArrowDownToLine size={16} /> CSV</a></div></article>)}</div>}</section>}

      {tab === 'device' && <div className="device-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Tu equipo</p><h2>Fuente de datos</h2></div><span className="subtle-badge">{sourceName}</span></div><dl className="device-details"><div><dt>Conexión</dt><dd>{status?.connected ? 'Recibiendo muestras' : 'Esperando señal'}</dd></div><div><dt>Batería</dt><dd>{status?.batteryPercent == null ? 'No informada' : `${status.batteryPercent}% · estimación por niveles`}</dd></div><div><dt>Reportes descartados en puente</dt><dd>{status?.sourceDiscarded ?? 0}</dd></div><div><dt>Lecturas rechazadas</dt><dd>{status?.rejected ?? 0}</dd></div></dl><div className="setup-steps"><h3>Conectar en Raspberry Pi</h3><p>Emparejá la tabla con BlueZ, detené otros lectores y ejecutá el proyecto con <code>SOURCE=wii</code>. Presioná el botón rojo SYNC cuando el servicio espere la conexión.</p><h3>Conectar desde Mac</h3><p>En The Balance Toolkit habilitá el stream TCP raw y comenzá una grabación. Ejecutá este servicio con <code>SOURCE=toolkit</code>.</p></div></section>
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Antes de empezar</p><h2>Calibración y referencia</h2></div></div><div className="calibration-step"><span className="step-number">1</span><div><h3>Vaciar y hacer tara</h3><p>Dejá la tabla sin carga y quieta durante un segundo.</p><button type="button" className="button" disabled={pending || !active || status?.source === 'simulator' || !!status?.recording} onClick={() => void run(() => api('/tare', 'POST'), 'Tara aplicada.')}>Hacer tara</button></div></div><div className="calibration-step"><span className="step-number">2</span><div><h3>Tomar tu peso de referencia</h3><p>Subite, mantenete quieto y tomá la referencia para calcular %BW.</p><button type="button" className="button" disabled={pending || !active || !!status?.recording} onClick={() => void run(() => api('/reference', 'POST'), 'Peso de referencia actualizado.')}>Tomar referencia</button></div></div>{status && <ConfigForm key={JSON.stringify(status.config)} config={status.config} disabled={pending || !!status.recording} save={changes => run(() => api('/config', 'PUT', changes), 'Configuración guardada.')} />}</section></div>}
      <footer><span>stance lab <span className="footer-separator">/</span> Un swing, más información.</span><span>Medición vertical · prototipo experimental</span></footer>
    </main>
  </div>
}

function Metric({ label, value, unit, detail, accent = false }: { label: string; value: string; unit: string; detail: string; accent?: boolean }) {
  return <div className={`metric ${accent ? 'accent' : ''}`}><dt>{label}</dt><dd><div className="metric-number">{value}<span>{unit}</span></div><p>{detail}</p></dd></div>
}

function ConfigForm({ config, save, disabled }: { config: Config; save: (changes: Partial<Config>) => Promise<void>; disabled: boolean }) {
  const [mass, setMass] = useState(config.bodyMassKg)
  const [width, setWidth] = useState(config.sensorWidthMm)
  const [depth, setDepth] = useState(config.sensorDepthMm)
  const [verified, setVerified] = useState(config.geometryVerified)
  return <form className="config-form" onSubmit={e => { e.preventDefault(); void save({ bodyMassKg: mass, sensorWidthMm: width, sensorDepthMm: depth, geometryVerified: verified }) }}><div className="field"><label htmlFor="body-mass">Peso de referencia · kg</label><input id="body-mass" name="bodyMassKg" type="number" min="10" max="200" step="0.01" required value={mass} onChange={e => setMass(Number(e.target.value))} /></div><details><summary>Geometría de los sensores</summary><p>Medí la distancia entre centros de apoyos. Las medidas iniciales son nominales; no habilitan coordenadas físicas hasta verificarlas.</p><div className="field-pair"><div className="field"><label htmlFor="sensor-width">Separación X · mm</label><input id="sensor-width" name="sensorWidthMm" type="number" min="50" max="1000" required value={width} onChange={e => setWidth(Number(e.target.value))} /></div><div className="field"><label htmlFor="sensor-depth">Separación Y · mm</label><input id="sensor-depth" name="sensorDepthMm" type="number" min="50" max="1000" required value={depth} onChange={e => setDepth(Number(e.target.value))} /></div></div><label className="checkbox-label"><input name="geometryVerified" type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />Verifiqué la separación de los sensores.</label></details><button type="submit" className="button" disabled={disabled}>Guardar configuración</button></form>
}
