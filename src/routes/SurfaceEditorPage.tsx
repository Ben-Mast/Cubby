import { useEffect, useReducer, useRef, useState, type PointerEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Redo2, Save, Trash2, Undo2 } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { createSurface, getSurface, updateSurface } from '../features/surfaces/data'
import { DEFAULT_PIXEL, DEFAULT_SURFACE_SIZE, MAX_SURFACE_SIZE, initialPixelHistory, pixelReducer,
  cellsOnLine, pixelsFromData, resizePixels, validateSurface, validSurfaceSize, type SurfaceDesign, type SurfaceType } from '../features/surfaces/model'

const palette = ['#ffffff', '#34323c', '#d9d5c8', '#8b5e3c', '#d6a66a', '#5b4bdb', '#e781a0', '#3c9b78', '#488ec7', '#f1cc58']
const CELL_DRAW_SIZE = 20

export function SurfaceEditorPage() {
  const { id } = useParams()
  const { identity } = useAuth()
  return <SurfaceEditorLoader key={`${identity?.id}:${id ?? 'new'}`} id={id} />
}
function SurfaceEditorLoader({ id }: { id?: string }) {
  const navigate = useNavigate()
  const [record, setRecord] = useState<SurfaceDesign | null>(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!id) return
    let active = true
    setLoading(true); setError('')
    void getSurface(id).then(data => { if (active) setRecord(data) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load the surface.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, attempt])
  if (loading) return <p role="status">Loading surface…</p>
  if (error) return <section className="page"><p role="alert" className="auth-error">{error}</p>
    <button onClick={() => setAttempt(value => value + 1)}>Retry</button> <Link to="/surfaces">Back to surfaces</Link></section>
  return <LocalSurfaceEditor key={record?.id ?? 'new'} record={record} onSave={async (name, type, width, height, pixels) => {
    if (id) await updateSurface(id, name, type, width, height, pixels)
    else await createSurface(name, type, width, height, pixels)
    navigate('/surfaces')
  }} />
}

export function LocalSurfaceEditor({ record, onSave }: {
  record?: SurfaceDesign | null
  onSave: (name: string, type: SurfaceType, width: number, height: number, pixels: readonly string[]) => Promise<void>
}) {
  const [name, setName] = useState(record?.name ?? '')
  const [type, setType] = useState<SurfaceType>(record?.type ?? 'floor')
  const [width, setWidth] = useState(record?.width ?? DEFAULT_SURFACE_SIZE)
  const [height, setHeight] = useState(record?.height ?? DEFAULT_SURFACE_SIZE)
  const [color, setColor] = useState('#5b4bdb')
  const [history, dispatch] = useReducer(pixelReducer, undefined, () => initialPixelHistory(record ?
    pixelsFromData(record.pixel_data, record.width, record.height) : Array(DEFAULT_SURFACE_SIZE ** 2).fill(DEFAULT_PIXEL)))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerRef = useRef<number | null>(null)
  const lastCellRef = useRef<number | null>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d')
    if (!canvas || !context) return
    for (let index = 0; index < history.present.length; index++) {
      const x = index % width * CELL_DRAW_SIZE, y = Math.floor(index / width) * CELL_DRAW_SIZE
      context.fillStyle = history.present[index]
      context.fillRect(x, y, CELL_DRAW_SIZE, CELL_DRAW_SIZE)
      context.strokeStyle = '#b9b1da'
      context.lineWidth = 1
      context.strokeRect(x + 0.5, y + 0.5, CELL_DRAW_SIZE - 1, CELL_DRAW_SIZE - 1)
    }
  }, [history.present, width, height])

  function cellAt(event: PointerEvent<HTMLCanvasElement>): number | null {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.floor((event.clientX - rect.left) / rect.width * width)
    const y = Math.floor((event.clientY - rect.top) / rect.height * height)
    return x >= 0 && x < width && y >= 0 && y < height ? y * width + x : null
  }
  function paint(event: PointerEvent<HTMLCanvasElement>) {
    const index = cellAt(event)
    if (index === null) return
    for (const cell of lastCellRef.current === null ? [index] : cellsOnLine(lastCellRef.current, index, width))
      dispatch({ type: 'paint', index: cell, color })
    lastCellRef.current = index
  }
  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (pointerRef.current !== event.pointerId) return
    pointerRef.current = null
    lastCellRef.current = null
    dispatch({ type: 'end' })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function resize(axis: 'width' | 'height', raw: string) {
    const value = Number(raw)
    if (!validSurfaceSize(value)) return
    const nextWidth = axis === 'width' ? value : width
    const nextHeight = axis === 'height' ? value : height
    dispatch({ type: 'resize', pixels: resizePixels(history.present, width, height, nextWidth, nextHeight) })
    setWidth(nextWidth); setHeight(nextHeight)
  }
  async function save() {
    if (savingRef.current) return
    savingRef.current = true; setError('')
    try {
      validateSurface(name, type, width, height, history.present)
      setSaving(true)
      await onSave(name, type, width, height, history.present)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save the surface.') }
    finally { savingRef.current = false; setSaving(false) }
  }

  return <section className="page surface-editor-page">
    <div className="surface-editor-topbar">
      <Link className="icon-button" aria-label="Back to surfaces" to="/surfaces"><ArrowLeft aria-hidden="true" /></Link>
      <input className="surface-name" aria-label="Surface name" placeholder="Surface name" value={name} disabled={saving} onChange={event => setName(event.target.value)} />
      <button className="icon-button" aria-label="Undo surface paint" disabled={!history.past.length || saving} onClick={() => dispatch({ type: 'undo' })}><Undo2 aria-hidden="true" /></button>
      <button className="icon-button" aria-label="Redo surface paint" disabled={!history.future.length || saving} onClick={() => dispatch({ type: 'redo' })}><Redo2 aria-hidden="true" /></button>
      <button className="icon-button" aria-label="Clear surface" disabled={saving || history.present.every(value => value === DEFAULT_PIXEL)} onClick={() => dispatch({ type: 'clear' })}><Trash2 aria-hidden="true" /></button>
      <button className="icon-button primary-icon" aria-label="Save surface" disabled={saving} onClick={() => void save()}><Save aria-hidden="true" /></button>
    </div>
    <div className="surface-editor-options">
      <label>Type <select aria-label="Surface type" value={type} disabled={saving || Boolean(record)} onChange={event => setType(event.target.value as SurfaceType)}>
        <option value="floor">Floor</option><option value="wall">Wall</option></select></label>
      <label>Width <input aria-label="Surface width" type="number" min="2" max={MAX_SURFACE_SIZE} value={width} disabled={saving} onChange={event => resize('width', event.target.value)} /></label>
      <label>Height <input aria-label="Surface height" type="number" min="2" max={MAX_SURFACE_SIZE} value={height} disabled={saving} onChange={event => resize('height', event.target.value)} /></label>
    </div>
    {error && <p role="alert" className="auth-error">{error}</p>}
    <canvas ref={canvasRef} className="surface-pixel-canvas" role="img" aria-label={`${width} by ${height} pixel ${type} pattern`}
      width={width * CELL_DRAW_SIZE} height={height * CELL_DRAW_SIZE}
      onPointerDown={event => { if (saving || event.button !== 0 || pointerRef.current !== null) return; pointerRef.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId); dispatch({ type: 'start' }); paint(event) }}
      onPointerMove={event => { if (pointerRef.current === event.pointerId) paint(event) }}
      onPointerUp={end} onPointerCancel={end} />
    <div className="surface-palette" role="group" aria-label="Paint colors">
      {palette.map(value => <button key={value} aria-label={`Paint ${value}`} aria-pressed={color === value}
        className="surface-swatch" style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}
      <input aria-label="Custom paint color" type="color" value={color} onChange={event => setColor(event.target.value)} />
    </div>
  </section>
}
