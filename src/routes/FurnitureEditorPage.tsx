import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Database, Eraser, Grid2X2, Hand, Paintbrush, PencilLine, Plus, Redo2, RotateCcw, Save, Trash2, Undo2, X } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { createFurniture, getFurniture, updateFurniture, validateFurniture, type FurnitureRecord } from '../features/furniture/data'
import { deserializeModel, emptyHistory, historyReducer, serializeModel, type BrushMode, type Coordinate, type EditMode, type VoxelModel } from '../features/voxel/model'
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
    existing={Boolean(id)} onSave={async (name, model) => {
      if (id) await updateFurniture(id, name, model)
      else await createFurniture(name, model)
      if (active.current) navigate('/furniture')
    }} />
}

export function LocalVoxelEditor({ existing = false, initialName = '', initialModel, onSave }: {
  existing?: boolean; initialName?: string; initialModel?: VoxelModel
  onSave?: (name: string, model: VoxelModel) => Promise<void>
}) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({ ...emptyHistory(), present: initialModel ?? new Map() }))
  const [mode, setMode] = useState<EditMode | 'camera'>('add')
  const [brushMode, setBrushMode] = useState<BrushMode>('stroke')
  const [color, setColor] = useState(palette[0])
  const [colorsOpen, setColorsOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const onStrokeEdit = useCallback((at: Coordinate, gestureMode: EditMode = mode === 'camera' ? 'add' : mode, gestureColor = color) => {
    if (!saving) dispatch({ type: 'stroke-edit', mode: gestureMode, at, color: gestureColor })
  }, [mode, color, saving])
  async function save() {
    if (!onSave || lock.current) return
    lock.current = true; setSaveError('')
    try {
      validateFurniture(name, history.present)
      setSaving(true)
      await onSave(name, history.present)
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
    {saveError && <p role="alert" className="auth-error">{saveError}</p>}
    <fieldset className="editor-fields immersive-workspace" disabled={saving}>
    <VoxelEditorScene model={history.present} mode={mode} brushMode={brushMode} color={color}
      onStrokeStart={() => dispatch({ type: 'stroke-start' })}
      onStrokeEdit={onStrokeEdit}
      onStrokeEnd={() => dispatch({ type: 'stroke-end' })}
      onStrokeCancel={() => dispatch({ type: 'stroke-cancel' })}
      onRectangle={(cells, tool, selectedColor) => dispatch({ type: 'rectangle', cells, mode: tool, color: selectedColor })} />
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
    {import.meta.env.DEV && <EditorDebugPanel name={name} model={history.present} onRestore={(restoredName, model) => {
      dispatch({ type: 'restore', model }); setName(restoredName)
    }} />}
    </fieldset>
  </section>
}

function EditorDebugPanel({ name, model, onRestore }: {
  name: string; model: VoxelModel; onRestore: (name: string, model: VoxelModel) => void
}) {
  const [snapshot, setSnapshot] = useState('')
  const [message, setMessage] = useState('')
  const capture = () => {
    setSnapshot(JSON.stringify({ name, voxel_data: JSON.parse(serializeModel(model)) }))
    setMessage('Local snapshot captured in memory. Nothing sent to Supabase.')
  }
  const restore = () => {
    try {
      const data = JSON.parse(snapshot)
      onRestore(data.name, deserializeModel(JSON.stringify(data.voxel_data)))
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
