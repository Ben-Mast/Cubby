import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { getFurniture, type FurnitureRecord } from '../features/furniture/data'
import { SharedRoomScene } from '../features/room/SharedRoomScene'
import { useSharedRoom } from '../features/room/useSharedRoom'
import { createPlacement, updatePlacement, removePlacement, type SharedRoomData } from '../features/room/data'
import { reconstructRoomModel, type RoomModel } from '../features/room/model'
import { rotate90, validatePlacement, type FloorPosition } from '../features/room/placement'

const placementActions = { create: createPlacement, update: updatePlacement, remove: removePlacement }
interface Draft { furnitureId: string; name: string; model: RoomModel; position: FloorPosition; movingId?: string }

export function RoomPage() {
  const { identity } = useAuth()
  return <RoomLoader key={identity?.id} />
}
function RoomLoader() {
  const { data, loading, error, syncError, refresh } = useSharedRoom()
  const [params, setParams] = useSearchParams()
  const furnitureId = params.get('place')
  const [design, setDesign] = useState<FurnitureRecord | null>(null)
  const [designError, setDesignError] = useState('')
  const [designLoading, setDesignLoading] = useState(false)
  const [designAttempt, setDesignAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setDesign(null); setDesignError(''); setDesignLoading(Boolean(furnitureId))
    if (furnitureId) void getFurniture(furnitureId).then(item => {
      reconstructRoomModel(item.voxel_data)
      if (active) setDesign(item)
    }).catch(reason => { if (active) setDesignError(reason instanceof Error ? reason.message : 'Unable to load placement design.') })
      .finally(() => { if (active) setDesignLoading(false) })
    return () => { active = false }
  }, [furnitureId, designAttempt])
  function clearDesign() { setDesign(null); setParams({}, { replace: true }) }
  return <section className="page room-page">
    <div className="page-heading"><div><p className="eyebrow">Shared room</p>
      <h1>{data?.home.name ?? 'Your shared room'}</h1></div></div>
    {(loading || designLoading) && <p role="status">Loading shared room…</p>}
    {(error || designError) && <div role="alert"><p>{error || designError}</p>
      <button className="text-button" onClick={() => { refresh(); setDesignAttempt(value => value + 1) }}>Try again</button>
      {furnitureId && <button className="text-button" onClick={clearDesign}>Cancel placement</button>}</div>}
    {syncError && <p role="status" className="auth-error">{syncError}</p>}
    <RoomWorkspace room={data} design={design} disabled={loading || designLoading || Boolean(error || designError)}
      refresh={refresh} clearDesign={clearDesign} />
  </section>
}

// HTML controls/state are separate from raycasting/rendering and Supabase queries.
export function RoomWorkspace({ room, design, disabled = false, refresh, clearDesign, actions = placementActions }: {
  room: SharedRoomData | null; design: FurnitureRecord | null; disabled?: boolean
  refresh: () => void; clearDesign: () => void; actions?: typeof placementActions
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [camera, setCamera] = useState(true)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    setDraft(design ? { furnitureId: design.id, name: design.name, model: reconstructRoomModel(design.voxel_data),
      position: { x: 0, z: 0, rotation: 0 } } : null)
    setSelectedId(''); setRemoving(false); setError(''); setCamera(!design)
  }, [design])
  const instances = room?.instances ?? []
  const selected = instances.find(item => item.placement.id === selectedId)
  const blocked = disabled || busy || !room
  const invalid = draft ? validatePlacement(draft.model, draft.position, instances, draft.movingId) : null
  const unavailable = Boolean(room?.warnings.length)
  function cancel() { setDraft(null); setError(''); setCamera(true); clearDesign() }
  function select(id: string) { if (blocked || draft) return; setSelectedId(id); setRemoving(false); setError('') }
  async function mutate(operation: () => Promise<unknown>, finish: () => void) {
    if (lock.current || blocked) return
    lock.current = true; setBusy(true); setError('')
    try { await operation(); if (active.current) { finish(); refresh() } }
    catch (reason) { if (active.current) { setError(reason instanceof Error ? reason.message : 'Unable to save room changes.'); refresh() } }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  function confirm() {
    if (!draft || invalid || unavailable) return
    void mutate(() => draft.movingId
      ? actions.update(draft.movingId, draft.furnitureId, draft.position)
      : actions.create(draft.furnitureId, draft.position), cancel)
  }
  function move() {
    if (!selected) return
    setDraft({ furnitureId: selected.placement.furniture_id, name: selected.name ?? 'Furniture', model: selected.model,
      position: { x: selected.placement.x, z: selected.placement.z, rotation: selected.placement.rotation }, movingId: selected.placement.id })
    setCamera(false); setError(''); setRemoving(false)
  }
  function rotateSelected() {
    if (!selected) return
    const position = { ...selected.placement, rotation: rotate90(selected.placement.rotation) }
    const invalidRotation = validatePlacement(selected.model, position, instances, selected.placement.id)
    if (invalidRotation) { setError(invalidRotation); return }
    void mutate(() => actions.update(selected.placement.id, selected.placement.furniture_id, position), () => {})
  }
  const preview = draft && room ? { name: draft.name, model: draft.model, placement: {
    id: 'preview', home_id: room.home.id, furniture_id: draft.furnitureId, ...draft.position,
  } } : null
  return <>
    <div className="editor-toolbar">
      <button disabled={blocked || removing} aria-pressed={camera} onClick={() => setCamera(true)}>Camera</button>
      <button disabled={blocked || removing} aria-pressed={!camera} onClick={() => setCamera(false)}>{draft ? 'Position furniture' : 'Select furniture'}</button>
      <button disabled={blocked} onClick={refresh}>Refresh room</button>
      <Link className="button-link" to="/furniture">Furniture library</Link>
    </div>
    <p>{camera ? 'Drag to orbit. Scroll or pinch to zoom. Switch modes to edit.'
      : draft ? 'Tap/click the floor to position the preview. Camera movement is off.' : 'Tap/click furniture to select it. Camera movement is off.'}</p>
    {room?.warnings.map((warning, index) => <p role="status" key={index}>{warning}</p>)}
    {room && !instances.length && !room.warnings.length && <p>The room is empty. Choose Place in Room from the furniture library.</p>}
    <fieldset className="editor-fields room-controls" disabled={blocked}>
      {draft ? <div className="placement-panel">
        <h2>{draft.movingId ? 'Move' : 'Place'} “{draft.name}”</h2>
        <p>Preview: x {draft.position.x}, z {draft.position.z}, rotation {draft.position.rotation}°</p>
        <div className="editor-toolbar">
          <button onClick={() => setDraft({ ...draft, position: { ...draft.position, rotation: rotate90(draft.position.rotation) } })}>Rotate preview 90°</button>
          <button disabled={Boolean(invalid) || unavailable} onClick={confirm}>{draft.movingId ? 'Confirm move' : 'Confirm placement'}</button>
          <button onClick={cancel}>Cancel placement</button>
        </div>
        {invalid && <p role="status" className="auth-error">{invalid}</p>}
      </div> : <>
        {instances.length > 0 && <label className="room-select">Placed furniture
          <select value={selected?.placement.id ?? ''} onChange={event => select(event.target.value)}>
            <option value="">Choose an item</option>
            {instances.map(item => <option key={item.placement.id} value={item.placement.id}>
              {item.name ?? 'Furniture'} — x {item.placement.x}, z {item.placement.z}, {item.placement.rotation}°
            </option>)}
          </select></label>}
        {selected && <div className="placement-panel"><h2>Selected: {selected.name ?? 'Furniture'}</h2>
          <div className="editor-toolbar"><button disabled={unavailable || removing} onClick={move}>Move</button>
            <button disabled={unavailable || removing} onClick={rotateSelected}>Rotate 90°</button>
            <button onClick={() => setRemoving(true)}>Remove</button></div>
          {removing && <div role="dialog" aria-label="Remove placed furniture">
            <p>Remove this placed copy? The saved furniture design stays in your library.</p>
            <div className="editor-toolbar"><button onClick={() => void mutate(() => actions.remove(selected.placement.id), () => { setSelectedId(''); setRemoving(false) })}>Confirm remove</button>
              <button onClick={() => setRemoving(false)}>Cancel remove</button></div>
          </div>}
        </div>}
      </>}
    </fieldset>
    {busy && <p role="status">Saving room changes…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    <SharedRoomScene instances={instances.filter(item => item.placement.id !== draft?.movingId)} selectedId={selectedId}
      preview={preview} previewInvalid={Boolean(invalid) || unavailable} cameraEnabled={camera && !blocked}
      onSelect={!camera && !draft && !blocked && !removing ? select : undefined}
      onPosition={!camera && draft && !blocked ? position => setDraft({ ...draft, position: { ...draft.position, ...position } }) : undefined} />
  </>
}
