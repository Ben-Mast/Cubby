import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Armchair, Check, Maximize2, Paintbrush, RefreshCw, RotateCw, Trash2, X } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { getFurniture, type FurnitureRecord } from '../features/furniture/data'
import { SharedRoomScene } from '../features/room/SharedRoomScene'
import { useSharedRoom } from '../features/room/useSharedRoom'
import { createPlacement, updatePlacement, removePlacement, updateRoomDimensions, type SharedRoomData } from '../features/room/data'
import { DEFAULT_ROOM_DIMENSIONS, MAX_ROOM_DIMENSIONS, validRoomDimensions, type RoomDimensions } from '../features/room/config'
import { reconstructRoomModel, type PlacedFurniture, type RoomInstance, type RoomModel } from '../features/room/model'
import { lowestRestingPosition, rotate90, validatePlacement, validateRoomResize, type PlacementPosition } from '../features/room/placement'
import { useHeaderAction } from '../app/AppShell'
import { RoomSurfacePicker } from '../features/surfaces/RoomSurfacePicker'

const placementActions = { create: createPlacement, update: updatePlacement, remove: removePlacement, resize: updateRoomDimensions }
interface Draft { furnitureId: string; name: string; model: RoomModel; position: PlacementPosition; movingId?: string }

export function RoomPage() {
  const { identity } = useAuth()
  return <RoomLoader key={identity?.id} />
}
function RoomLoader() {
  const { data, loading, error, syncError, refresh, upsertPlacement, removePlacement } = useSharedRoom()
  const setHeaderAction = useHeaderAction()
  const [params, setParams] = useSearchParams()
  const furnitureId = params.get('place')
  const [design, setDesign] = useState<FurnitureRecord | null>(null)
  const [designError, setDesignError] = useState('')
  const [designLoading, setDesignLoading] = useState(false)
  const [designAttempt, setDesignAttempt] = useState(0)
  useEffect(() => {
    setHeaderAction({ content: <button className="nav-link nav-button" aria-label="Refresh room" title="Refresh" disabled={loading} onClick={refresh}><RefreshCw aria-hidden="true" /></button> })
    return () => setHeaderAction(null)
  }, [loading, refresh, setHeaderAction])
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
  return <section className="page immersive-page room-page">
    {(loading || designLoading) && <p className="floating-status" role="status">Loading shared room…</p>}
    {(error || designError) && <div className="floating-status" role="alert"><p>{error || designError}</p>
      <div className="icon-actions"><button className="icon-button" aria-label="Retry" title="Retry" onClick={() => { refresh(); setDesignAttempt(value => value + 1) }}><RefreshCw aria-hidden="true" /></button>
      {furnitureId && <button className="icon-button" aria-label="Cancel placement" title="Cancel" onClick={clearDesign}><X aria-hidden="true" /></button>}</div></div>}
    {syncError && <p role="status" className="auth-error floating-status">{syncError}</p>}
    <RoomWorkspace room={data} design={design} disabled={loading || designLoading || Boolean(error || designError)}
      refresh={refresh} upsertPlacement={upsertPlacement} removePlacement={removePlacement}
      clearDesign={clearDesign} chooseFurniture={id => setParams({ place: id })} />
  </section>
}

export function RoomWorkspace({ room, design, disabled = false, refresh, upsertPlacement, removePlacement: removeLocalPlacement,
  clearDesign, chooseFurniture, actions = placementActions }: {
  room: SharedRoomData | null; design: FurnitureRecord | null; disabled?: boolean
  refresh: () => void; upsertPlacement?: (instance: RoomInstance) => void; removePlacement?: (id: string) => void
  clearDesign: () => void; chooseFurniture: (id: string) => void; actions?: typeof placementActions
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const dragOrigin = useRef<Draft | null>(null)
  const dragOffset = useRef({ x: 0, z: 0 })
  const [selectedId, setSelectedId] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [surfacePickerOpen, setSurfacePickerOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [roomSize, setRoomSize] = useState<RoomDimensions>(DEFAULT_ROOM_DIMENSIONS)
  const [removing, setRemoving] = useState(false)
  const [hiddenId, setHiddenId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    const next = design ? { furnitureId: design.id, name: design.name, model: reconstructRoomModel(design.voxel_data),
      position: { x: 0, y: 0, z: 0, rotation: 0 as const } } : null
    draftRef.current = next; setDraft(next)
    setSelectedId(''); setRemoving(false); setPickerOpen(false); setError('')
  }, [design])
  const instances = room?.instances ?? []
  const dimensions = room ? { width: room.home.width, depth: room.home.depth, height: room.home.height }
    : DEFAULT_ROOM_DIMENSIONS
  const selected = instances.find(item => item.placement.id === selectedId)
  const blocked = disabled || busy || !room
  const invalid = draft ? validatePlacement(draft.model, draft.position, instances, draft.movingId, dimensions) : null
  const unavailable = Boolean(room?.warnings.length)
  function updateDraft(next: Draft | null) { draftRef.current = next; setDraft(next) }
  function resting(draft: Draft, x: number, z: number, rotation = draft.position.rotation): PlacementPosition {
    return lowestRestingPosition(draft.model, x, z, rotation, instances, draft.movingId, dimensions) ?? { x, y: 0, z, rotation }
  }
  function cancelPlacement() { updateDraft(null); setError(''); clearDesign() }
  function select(id: string) { if (blocked || draft) return; setSelectedId(id); setRemoving(false); setError('') }
  async function mutate<T>(operation: () => Promise<T>, finish: (result: T) => void, fail?: () => void) {
    if (lock.current || blocked) return
    lock.current = true; setBusy(true); setError('')
    try { const result = await operation(); if (active.current) finish(result) }
    catch (reason) { if (active.current) {
      fail?.()
      setError(reason instanceof Error ? reason.message : 'Unable to save room changes.'); refresh()
    } }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  function confirmPlacement() {
    if (!draft || invalid || unavailable) return
    void mutate(() => actions.create(draft.furnitureId, draft.position), row => {
      upsertPlacement?.({ placement: row, model: draft.model, name: draft.name })
      cancelPlacement()
    })
  }
  function rotateDraft() {
    if (!draft) return
    updateDraft({ ...draft, position: resting(draft, draft.position.x, draft.position.z, rotate90(draft.position.rotation)) })
  }
  function rotateSelected() {
    if (!selected) return
    const moving: Draft = { furnitureId: selected.placement.furniture_id, name: selected.name ?? 'Furniture',
      model: selected.model, position: selected.placement, movingId: selected.placement.id }
    const position = resting(moving, selected.placement.x, selected.placement.z, rotate90(selected.placement.rotation))
    const invalidRotation = validatePlacement(selected.model, position, instances, selected.placement.id, dimensions)
    if (invalidRotation) { setError(invalidRotation); return }
    updateDraft({ furnitureId: selected.placement.furniture_id, name: selected.name ?? 'Furniture', model: selected.model,
      position, movingId: selected.placement.id })
    void mutate(() => actions.update(selected.placement.id, selected.placement.furniture_id, position), row => {
      upsertPlacement?.({ ...selected, placement: row }); updateDraft(null)
    }, () => updateDraft(null))
  }
  function startDrag(id: string | null, position: { x: number; z: number } | null) {
    if (blocked || removing) return false
    if (draft && !draft.movingId && position) {
      dragOrigin.current = draft
      dragOffset.current = id === 'preview'
        ? { x: draft.position.x - position.x, z: draft.position.z - position.z }
        : { x: 0, z: 0 }
      updateDraft({ ...draft, position: resting(draft, position.x + dragOffset.current.x, position.z + dragOffset.current.z) })
      return true
    }
    if (selected && id === selected.placement.id) {
      const moving: Draft = { furnitureId: selected.placement.furniture_id, name: selected.name ?? 'Furniture', model: selected.model,
        position: { x: selected.placement.x, y: selected.placement.y, z: selected.placement.z,
          rotation: selected.placement.rotation }, movingId: selected.placement.id }
      dragOrigin.current = moving
      dragOffset.current = position ? { x: moving.position.x - position.x, z: moving.position.z - position.z } : { x: 0, z: 0 }
      updateDraft(moving)
      return true
    }
    return false
  }
  function dragTo(position: { x: number; z: number }) {
    const current = draftRef.current
    if (current) updateDraft({ ...current, position: resting(current,
      position.x + dragOffset.current.x, position.z + dragOffset.current.z) })
  }
  function endDrag(position: { x: number; z: number } | null) {
    let current = draftRef.current
    if (!current) return
    if (position) current = { ...current, position: resting(current,
      position.x + dragOffset.current.x, position.z + dragOffset.current.z) }
    dragOrigin.current = null
    if (!current.movingId) { updateDraft(current); return }
    const issue = validatePlacement(current.model, current.position, instances, current.movingId, dimensions)
    if (issue || unavailable) { updateDraft(null); setError(issue || 'Room data is unavailable. Refresh and try again.'); return }
    updateDraft(current)
    const movingId = current.movingId
    const moving = selected
    void mutate(() => actions.update(movingId, current.furnitureId, current.position), row => {
      if (moving) upsertPlacement?.({ ...moving, placement: row })
      updateDraft(null)
    }, () => updateDraft(null))
  }
  function cancelDrag() {
    const origin = dragOrigin.current
    dragOrigin.current = null
    if (!origin) return
    updateDraft(origin.movingId ? null : origin)
  }
  const preview = draft && !draft.movingId && room ? { name: draft.name, model: draft.model, placement: {
    id: 'preview', home_id: room.home.id, furniture_id: draft.furnitureId, ...draft.position,
  } } : null
  const visibleInstances = instances.filter(item => item.placement.id !== hiddenId)
    .filter(item => !(busy && draft && !draft.movingId && item.placement.furniture_id === draft.furnitureId
      && item.placement.x === draft.position.x && item.placement.z === draft.position.z
      && item.placement.y === draft.position.y
      && item.placement.rotation === draft.position.rotation))
    .map(item => item.placement.id === draft?.movingId
      ? { ...item, placement: { ...item.placement, ...draft.position } as PlacedFurniture } : item)
  return <div className="room-workspace">
    {room && !instances.length && <span className="sr-only">The room is empty.</span>}
    {room?.warnings.map((warning, index) => <p role="status" className="floating-status" key={index}>{warning}</p>)}
    {busy && <p role="status" className="sr-only">Saving room changes…</p>}
    {error && <p role="alert" className="auth-error floating-status">{error}</p>}
    <SharedRoomScene instances={visibleInstances} dimensions={dimensions} floorSurface={room?.floorSurface} wallSurface={room?.wallSurface} selectedId={selectedId}
      preview={preview} previewInvalid={Boolean(invalid) || unavailable} disabled={blocked}
      onSelect={select} onDragStart={startDrag} onDrag={dragTo} onDragEnd={endDrag} onDragCancel={cancelDrag} />
    <button className="icon-button room-size-button" aria-label="Edit room size" title="Room size" disabled={blocked}
      onClick={() => { setRoomSize({ width: dimensions.width, depth: dimensions.depth, height: dimensions.height }); setError(''); setSizeOpen(true) }}>
      <Maximize2 aria-hidden="true" />
    </button>
    <div className="bottom-toolbar room-bottom-toolbar">
      {draft && !draft.movingId ? <>
        <button aria-label="Cancel placement" title="Cancel" onClick={cancelPlacement}><X aria-hidden="true" /></button>
        <button aria-label="Rotate preview 90 degrees" title="Rotate" onClick={rotateDraft}><RotateCw aria-hidden="true" /></button>
        <button aria-label="Confirm placement" title="Confirm" disabled={Boolean(invalid) || unavailable} onClick={confirmPlacement}><Check aria-hidden="true" /></button>
      </> : selected ? <>
        <button aria-label="Rotate selected furniture 90 degrees" title="Rotate" disabled={busy || unavailable || removing} onClick={rotateSelected}><RotateCw aria-hidden="true" /></button>
        <button className="danger-button" aria-label="Remove selected furniture" title="Remove" disabled={busy} onClick={() => setRemoving(true)}><Trash2 aria-hidden="true" /></button>
      </> : <>
        <button className="primary-wide" aria-label="Open furniture picker" title="Furniture" disabled={blocked}
          onClick={() => { setSurfacePickerOpen(false); setPickerOpen(true) }}><Armchair aria-hidden="true" /></button>
        <button className="primary-wide" aria-label="Open surface picker" title="Surfaces" disabled={blocked}
          onClick={() => { setPickerOpen(false); setSurfacePickerOpen(true) }}><Paintbrush aria-hidden="true" /></button>
      </>}
    </div>
    {invalid && <p role="status" className="placement-feedback">{invalid}</p>}
    {sizeOpen && <div className="bottom-sheet room-size-sheet" role="dialog" aria-label="Edit room size">
      <div className="sheet-heading"><strong>Room size (voxels)</strong><button className="icon-button" aria-label="Close room size" onClick={() => setSizeOpen(false)}><X aria-hidden="true" /></button></div>
      <div className="dimension-fields">{(['width', 'depth', 'height'] as const).map(axis => <label key={axis}>{axis}
        <input aria-label={`Room ${axis}`} type="number" min="1" max={MAX_ROOM_DIMENSIONS[axis]} step="1"
          value={roomSize[axis]} disabled={busy} onChange={event => setRoomSize(current => ({ ...current, [axis]: Number(event.target.value) }))} /></label>)}</div>
      <button className="icon-button primary-icon" aria-label="Save room size" disabled={busy} onClick={() => {
        if (!validRoomDimensions(roomSize)) { setError('Room dimensions must be whole voxels within the allowed range.'); return }
        const issue = validateRoomResize(instances, roomSize)
        if (issue) { setError(issue); return }
        void mutate(() => actions.resize(roomSize), () => { setSizeOpen(false); refresh() })
      }}><Check aria-hidden="true" /></button>
    </div>}
    {pickerOpen && <div className="bottom-sheet furniture-sheet" role="dialog" aria-label="Choose furniture">
      <div className="sheet-heading sheet-heading-end"><button className="icon-button" aria-label="Close furniture picker" title="Close" onClick={() => setPickerOpen(false)}><X aria-hidden="true" /></button></div>
      {room?.furniture.length ? <div className="furniture-tray">{room.furniture.map(item => <button key={item.id}
        onClick={() => { setPickerOpen(false); chooseFurniture(item.id) }}><strong>{item.name}</strong><small>by {item.creator?.display_name ?? 'Unknown'}</small></button>)}</div>
        : <p>Your shared furniture library is empty.</p>}
    </div>}
    {surfacePickerOpen && <RoomSurfacePicker onClose={() => setSurfacePickerOpen(false)}
      onApplied={() => { setSurfacePickerOpen(false); refresh() }} />}
    {removing && selected && <div className="bottom-sheet confirmation-sheet" role="dialog" aria-label="Remove placed furniture">
      <strong>Remove {selected.name ?? 'this furniture'}?</strong><p>The saved design stays in your library.</p>
      <div className="sheet-actions"><button className="icon-button" aria-label="Cancel removal" title="Cancel" onClick={() => setRemoving(false)}><X aria-hidden="true" /></button>
        <button className="icon-button danger-icon" aria-label="Confirm removal" title="Remove" disabled={busy} onClick={() => {
          setHiddenId(selected.placement.id)
          void mutate(() => actions.remove(selected.placement.id), () => {
            removeLocalPlacement?.(selected.placement.id)
            setHiddenId(''); setSelectedId(''); setRemoving(false)
          }, () => setHiddenId(''))
        }}><Trash2 aria-hidden="true" /></button></div>
    </div>}
  </div>
}
