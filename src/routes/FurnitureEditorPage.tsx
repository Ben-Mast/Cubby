import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { createFurniture, getFurniture, updateFurniture, validateFurniture, type FurnitureRecord } from '../features/furniture/data'
import { deserializeModel, emptyHistory, historyReducer, serializeModel, type Coordinate, type EditMode, type VoxelModel } from '../features/voxel/model'
import { VoxelEditorScene } from '../features/voxel/VoxelEditorScene'

const palette = ['#8b5e3c', '#d6a66a', '#5b4bdb', '#e781a0', '#3c9b78', '#488ec7', '#f1cc58', '#ffffff', '#34323c']
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
  if (error) return <section><p role="alert" className="auth-error">{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry</button> <Link to="/furniture">Back to library</Link></section>
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
  const [mode, setMode] = useState<EditMode>('add')
  const [cameraMode, setCameraMode] = useState(false)
  const [color, setColor] = useState(palette[0])
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const onEdit = useCallback((at: Coordinate) => { if (!saving) dispatch({ type: 'edit', mode, at, color }) }, [mode, color, saving])
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
  return <section className="page">
    <div className="page-heading"><div><p className="eyebrow">Voxel editor</p>
      <h1>{existing ? 'Edit furniture' : 'Create furniture'}</h1></div>
      <span className="status-pill">{history.present.size} / 4096 voxels</span></div>
    <p>{onSave ? 'Save to your shared furniture library. Unsaved changes are discarded when leaving or reloading.' : 'Local test draft. Leaving or reloading discards this draft.'}</p>
    {onSave && <div className="editor-toolbar"><button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Save furniture'}</button><Link to="/furniture">Back to library</Link></div>}
    {saveError && <p role="alert" className="auth-error">{saveError}</p>}
    <fieldset className="editor-fields" disabled={saving}>
    <label className="editor-name">Furniture name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Cozy chair" /></label>
    <div className="editor-toolbar" role="group" aria-label="Editing mode">
      {(['add', 'delete', 'paint'] as const).map(tool => <button key={tool} aria-pressed={!cameraMode && mode === tool}
        onClick={() => { setMode(tool); setCameraMode(false) }}>{tool[0].toUpperCase() + tool.slice(1)}</button>)}
      <button aria-pressed={cameraMode} onClick={() => setCameraMode(!cameraMode)}>Camera</button>
    </div>
    <div className="editor-toolbar" role="group" aria-label="Voxel color">
      {palette.map(value => <button key={value} className="color-swatch" aria-label={`Color ${value}`} aria-pressed={color === value}
        style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}
      <label className="custom-color">Custom color <input type="color" aria-label="Custom voxel color" value={color} onChange={event => setColor(event.target.value)} /></label>
    </div>
    <div className="editor-toolbar" role="group" aria-label="Edit history">
      <button disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}>Undo</button>
      <button disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}>Redo</button>
      <button disabled={!history.present.size} onClick={() => dispatch({ type: 'clear' })}>Clear</button>
    </div>
    <p className="editor-help">{cameraMode ? 'Camera: drag or swipe to orbit; scroll or pinch with two fingers to zoom. Select Add, Delete or Paint to edit.'
      : `${mode[0].toUpperCase() + mode.slice(1)}: click or tap ${mode === 'add' ? 'the floor to start, or a cube face to add beside it' : 'an existing cube'}. Drags do not edit. Select Camera to orbit or zoom.`} Coordinates: 0–15 on each axis.</p>
    <VoxelEditorScene model={history.present} mode={mode} cameraMode={cameraMode} onEdit={onEdit} />
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
  return <details className="editor-debug"><summary>Local/debug serialization</summary>
    <p>Capture the name and voxel JSON in memory, change or clear the model, then restore it. This is not shared saving or file import/export.</p>
    <div className="editor-toolbar"><button onClick={capture}>Capture snapshot</button>
      <button disabled={!snapshot} onClick={restore}>Restore snapshot</button></div>
    {snapshot && <textarea aria-label="Serialized local snapshot" readOnly value={snapshot} rows={5} />}
    <p role="status">{message}</p>
  </details>
}
