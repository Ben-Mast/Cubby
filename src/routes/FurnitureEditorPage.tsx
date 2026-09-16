import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Database, Eraser, Grid2X2, Hand, Paintbrush, PencilLine, Plus, Redo2, RotateCcw, Save, Trash2, Undo2, X } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { createFurniture, getFurniture, updateFurniture, validateFurniture, type FurnitureRecord } from '../features/furniture/data'
import { DEFAULT_VOXEL_SIZE, MAX_EDITOR_DIMENSION, deserializeModel, emptyHistory, historyReducer, serializeModel, validVoxelSize, type BrushMode, type Coordinate, type EditMode, type VoxelModel, type VoxelSize } from '../features/voxel/model'
import { VoxelEditorScene } from '../features/voxel/VoxelEditorScene'

const palette = ['#8b5e3c', '#d6a66a', '#5b4bdb', '#e781a0', '#3c9b78', '#488ec7', '#f1cc58', '#ffffff', '#34323c']
const tools = [
  { mode: 'add' as const, label: 'Add voxel', Icon: Plus },
  { mode: 'delete' as const, label: 'Delete voxel', Icon: Eraser },
  { mode: 'paint' as const, label: 'Paint voxel', Icon: Paintbrush },
]
export function FurnitureEditorPage() {
  const { id } = useParams()
  const { identity } = useAuth()
  return <FurnitureEditorLoader key={`${identity?.id}:${id ?? 'new'}`} id={id} />
}
function FurnitureEditorLoader({ id }: { id?: string }) {
  const navigate = useNavigate()
  const [record, setRecord] = useState<FurnitureRecord | null>(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (!id) return
    let current = true
    setLoading(true); setError(''); setRecord(null)
    void getFurniture(id).then(data => { if (current) setRecord(data) })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'Unable to load furniture.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [id, attempt])
  if (loading) return <p role="status">Loading furniture…</p>
  if (error) return <section><p role="alert" className="auth-error">{error}</p><div className="icon-actions">
    <button className="icon-button" aria-label="Retry" title="Retry" onClick={() => setAttempt(value => value + 1)}><RotateCcw aria-hidden="true" /></button>
    <Link className="icon-button" aria-label="Back to furniture" title="Back" to="/furniture"><ArrowLeft aria-hidden="true" /></Link></div></section>
  return <LocalVoxelEditor initialName={record?.name} initialModel={record ? deserializeModel(JSON.stringify(record.voxel_data)) : undefined}
    initialSize={record?.voxel_data.size}
    existing={Boolean(id)} onSave={async (name, model, size) => {
      if (id) await updateFurniture(id, name, model, size)
      else await createFurniture(name, model, size)
      if (active.current) navigate('/furniture')
    }} />
}

export function LocalVoxelEditor({ existing = false, initialName = '', initialModel, initialSize = DEFAULT_VOXEL_SIZE, onSave }: {
  existing?: boolean; initialName?: string; initialModel?: VoxelModel; initialSize?: VoxelSize
  onSave?: (name: string, model: VoxelModel, size: VoxelSize) => Promise<void>
}) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({ ...emptyHistory(), present: initialModel ?? new Map() }))
  const [mode, setMode] = useState<EditMode | 'camera'>('add')
  const [brushMode, setBrushMode] = useState<BrushMode>('stroke')
  const [color, setColor] = useState(palette[0])
  const [colorsOpen, setColorsOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [size, setSize] = useState<VoxelSize>(initialSize)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const onStrokeEdit = useCallback((at: Coordinate, gestureMode: EditMode = mode === 'camera' ? 'add' : mode, gestureColor = color) => {
    if (!saving) dispatch({ type: 'stroke-edit', mode: gestureMode, at, color: gestureColor, size })
  }, [mode, color, saving, size])
  function changeSize(axis: number, raw: string) {
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1 || value > MAX_EDITOR_DIMENSION) return
    const next = [...size] as VoxelSize
    next[axis] = value
    if ([...history.present.values()].some(voxel => [voxel.x, voxel.y, voxel.z][axis] >= value)) {
      setSaveError('Remove voxels outside the smaller workspace before resizing.'); return
    }
    setSaveError(''); dispatch({ type: 'dimension-change' }); setSize(next)
  }
  async function save() {
    if (!onSave || lock.current) return
    lock.current = true; setSaveError('')
    try {
      validateFurniture(name, history.present, size)
      setSaving(true)
      await onSave(name, history.present, size)
    } catch (reason) { if (active.current) setSaveError(reason instanceof Error ? reason.message : 'Unable to save furniture.') }
    finally { lock.current = false; if (active.current) setSaving(false) }
  }
  return <section className="page immersive-page editor-page">
    <div className="editor-topbar">
      <Link className="icon-button" to="/furniture" aria-label="Back to furniture" title="Back"><ArrowLeft aria-hidden="true" /></Link>
      <label className="editor-name"><span className="sr-only">Furniture name</span><input aria-label="Furniture name" value={name} onChange={event => setName(event.target.value)} placeholder="Name" disabled={saving} /></label>
      <span className="status-pill" aria-label={`${history.present.size} voxels`}>{history.present.size}</span>
      <button className="icon-button" aria-label="Undo" title="Undo" disabled={!history.past.length || saving} onClick={() => dispatch({ type: 'undo' })}><Undo2 aria-hidden="true" /></button>
      <button className="icon-button" aria-label="Redo" title="Redo" disabled={!history.future.length || saving} onClick={() => dispatch({ type: 'redo' })}><Redo2 aria-hidden="true" /></button>
      <button className="icon-button color-button" aria-label="Choose voxel color" title="Color" aria-expanded={colorsOpen} onClick={() => setColorsOpen(value => !value)}>
        <span className="color-dot" style={{ backgroundColor: color }} />
      </button>
      <button className="icon-button" aria-label="Clear furniture" title="Clear" disabled={!history.present.size || saving}
        onClick={() => dispatch({ type: 'clear' })}><Trash2 aria-hidden="true" /></button>
      {onSave && <button className="icon-button primary-icon" aria-label={saving ? 'Saving furniture' : existing ? 'Save changes' : 'Save furniture'} title="Save" disabled={saving} onClick={() => void save()}><Save aria-hidden="true" /></button>}
    </div>
    <div className="editor-dimensions" role="group" aria-label="Furniture workspace dimensions">
      {(['Width', 'Height', 'Depth'] as const).map((label, axis) => <label key={label}>{label}
        <input type="number" min="1" max={MAX_EDITOR_DIMENSION} step="1" aria-label={`Furniture ${label.toLowerCase()}`}
          value={size[axis]} disabled={saving} onChange={event => changeSize(axis, event.target.value)} /></label>)}
    </div>
    {saveError && <p role="alert" className="auth-error">{saveError}</p>}
    <fieldset className="editor-fields immersive-workspace" disabled={saving}>
    <VoxelEditorScene model={history.present} size={size} mode={mode} brushMode={brushMode} color={color}
      onStrokeStart={() => dispatch({ type: 'stroke-start' })}
      onStrokeEdit={onStrokeEdit}
      onStrokeEnd={() => dispatch({ type: 'stroke-end' })}
      onStrokeCancel={() => dispatch({ type: 'stroke-cancel' })}
      onRectangle={(cells, tool, selectedColor) => dispatch({ type: 'rectangle', cells, mode: tool, color: selectedColor, size })} />
    <div className="bottom-toolbar" role="group" aria-label="Editing tools">
      <button aria-label="Camera mode" title="Camera" aria-pressed={mode === 'camera'}
        onClick={() => setMode('camera')}><Hand aria-hidden="true" /></button>
      {tools.map(({ mode: tool, label, Icon }) => <button key={tool} aria-label={label} title={label} aria-pressed={mode === tool}
        onClick={() => setMode(tool)}><Icon aria-hidden="true" /></button>)}
      <button aria-label={`Brush mode: ${brushMode === 'stroke' ? 'Stroke' : 'Rectangle Fill'}`}
        title={brushMode === 'stroke' ? 'Stroke — switch to Rectangle Fill' : 'Rectangle Fill — switch to Stroke'}
        onClick={() => setBrushMode(value => value === 'stroke' ? 'rectangle' : 'stroke')}>
        {brushMode === 'stroke' ? <PencilLine aria-hidden="true" /> : <Grid2X2 aria-hidden="true" />}
      </button>
    </div>
    {colorsOpen && <div className="bottom-sheet color-sheet" role="dialog" aria-label="Choose voxel color">
      <div className="sheet-heading sheet-heading-end"><button className="icon-button" aria-label="Close color picker" title="Close" onClick={() => setColorsOpen(false)}><X aria-hidden="true" /></button></div>
      <div className="palette-grid">{palette.map(value => <button key={value} className="color-swatch" aria-label={`Color ${value}`} aria-pressed={color === value}
        style={{ backgroundColor: value }} onClick={() => { setColor(value); setColorsOpen(false) }} />)}
        <label className="custom-color"><span className="sr-only">Custom voxel color</span><input type="color" aria-label="Custom voxel color" value={color}
          onChange={event => setColor(event.target.value)} onBlur={() => setColorsOpen(false)} /></label></div>
    </div>}
    {import.meta.env.DEV && <EditorDebugPanel name={name} model={history.present} size={size} onRestore={(restoredName, model, restoredSize) => {
      dispatch({ type: 'restore', model }); setName(restoredName); setSize(restoredSize)
    }} />}
    </fieldset>
  </section>
}

function EditorDebugPanel({ name, model, size, onRestore }: {
  name: string; model: VoxelModel; size: VoxelSize; onRestore: (name: string, model: VoxelModel, size: VoxelSize) => void
}) {
  const [snapshot, setSnapshot] = useState('')
  const [message, setMessage] = useState('')
  const capture = () => {
    setSnapshot(JSON.stringify({ name, voxel_data: JSON.parse(serializeModel(model, size)) }))
    setMessage('Local snapshot captured in memory. Nothing sent to Supabase.')
  }
  const restore = () => {
    try {
      const data = JSON.parse(snapshot)
      if (!validVoxelSize(data.voxel_data.size)) throw new Error('Invalid size')
      onRestore(data.name, deserializeModel(JSON.stringify(data.voxel_data)), data.voxel_data.size)
      setMessage('Snapshot restored. Undo can recover the previous voxel model.')
    } catch { setMessage('Could not restore this snapshot.') }
  }
  return <details className="editor-debug"><summary aria-label="Local debug serialization"><Database aria-hidden="true" /></summary>
    <div className="icon-actions"><button className="icon-button" aria-label="Capture local snapshot" title="Capture" onClick={capture}><Database aria-hidden="true" /></button>
      <button className="icon-button" aria-label="Restore local snapshot" title="Restore" disabled={!snapshot} onClick={restore}><RotateCcw aria-hidden="true" /></button></div>
    {snapshot && <textarea aria-label="Serialized local snapshot" readOnly value={snapshot} rows={5} />}
    <p role="status">{message}</p>
  </details>
}
