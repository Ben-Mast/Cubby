import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Armchair, Check, RefreshCw, RotateCw, Trash2, X } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { getFurniture, type FurnitureRecord } from '../features/furniture/data'
import { SharedRoomScene } from '../features/room/SharedRoomScene'
import { useSharedRoom } from '../features/room/useSharedRoom'
import { createPlacement, updatePlacement, removePlacement, type SharedRoomData } from '../features/room/data'
import { reconstructRoomModel, type RoomModel } from '../features/room/model'
import { rotate90, validatePlacement, type FloorPosition } from '../features/room/placement'
import { useHeaderAction } from '../app/AppShell'

const placementActions = { create: createPlacement, update: updatePlacement, remove: removePlacement }
interface Draft { furnitureId: string; name: string; model: RoomModel; position: FloorPosition; movingId?: string }

export function RoomPage() {
  const { identity } = useAuth()
  return <RoomLoader key={identity?.id} />
}
function RoomLoader() {
  const { data, loading, error, syncError, refresh } = useSharedRoom()
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
      refresh={refresh} clearDesign={clearDesign} chooseFurniture={id => setParams({ place: id })} />
  </section>
}

export function RoomWorkspace({ room, design, disabled = false, refresh, clearDesign, chooseFurniture, actions = placementActions }: {
  room: SharedRoomData | null; design: FurnitureRecord | null; disabled?: boolean
  refresh: () => void; clearDesign: () => void; chooseFurniture: (id: string) => void; actions?: typeof placementActions
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const dragOrigin = useRef<Draft | null>(null)
  const dragOffset = useRef({ x: 0, z: 0 })
  const [selectedId, setSelectedId] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    const next = design ? { furnitureId: design.id, name: design.name, model: reconstructRoomModel(design.voxel_data),
      position: { x: 0, z: 0, rotation: 0 as const } } : null
    draftRef.current = next; setDraft(next)
    setSelectedId(''); setRemoving(false); setPickerOpen(false); setError('')
  }, [design])
  const instances = room?.instances ?? []
  const selected = instances.find(item => item.placement.id === selectedId)
  const blocked = disabled || busy || !room
  const invalid = draft ? validatePlacement(draft.model, draft.position, instances, draft.movingId) : null
  const unavailable = Boolean(room?.warnings.length)
  function updateDraft(next: Draft | null) { draftRef.current = next; setDraft(next) }
  function cancelPlacement() { updateDraft(null); setError(''); clearDesign() }
  function select(id: string) { if (blocked || draft) return; setSelectedId(id); setRemoving(false); setError('') }
  async function mutate(operation: () => Promise<unknown>, finish: () => void) {
    if (lock.current || blocked) return
    lock.current = true; setBusy(true); setError('')
    try { await operation(); if (active.current) { finish(); refresh() } }
    catch (reason) { if (active.current) {
      if (draftRef.current?.movingId) updateDraft(null)
      setError(reason instanceof Error ? reason.message : 'Unable to save room changes.'); refresh()
    } }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  function confirmPlacement() {
    if (!draft || invalid || unavailable) return
    void mutate(() => actions.create(draft.furnitureId, draft.position), cancelPlacement)
  }
  function rotateDraft() {
    if (!draft) return
    updateDraft({ ...draft, position: { ...draft.position, rotation: rotate90(draft.position.rotation) } })
  }
  function rotateSelected() {
    if (!selected) return
    const position = { ...selected.placement, rotation: rotate90(selected.placement.rotation) }
    const invalidRotation = validatePlacement(selected.model, position, instances, selected.placement.id)
    if (invalidRotation) { setError(invalidRotation); return }
    updateDraft({ furnitureId: selected.placement.furniture_id, name: selected.name ?? 'Furniture', model: selected.model,
      position, movingId: selected.placement.id })
    void mutate(() => actions.update(selected.placement.id, selected.placement.furniture_id, position), () => updateDraft(null))
  }
  function startDrag(id: string | null, position: { x: number; z: number } | null) {
    if (blocked || removing) return false
    if (draft && !draft.movingId && position) {
      dragOrigin.current = draft
      dragOffset.current = id === 'preview'
        ? { x: draft.position.x - position.x, z: draft.position.z - position.z }
        : { x: 0, z: 0 }
      updateDraft({ ...draft, position: { ...draft.position,
        x: position.x + dragOffset.current.x, z: position.z + dragOffset.current.z } })
      return true
    }
    if (selected && id === selected.placement.id) {
      const moving: Draft = { furnitureId: selected.placement.furniture_id, name: selected.name ?? 'Furniture', model: selected.model,
        position: { x: selected.placement.x, z: selected.placement.z, rotation: selected.placement.rotation }, movingId: selected.placement.id }
      dragOrigin.current = moving
      dragOffset.current = position ? { x: moving.position.x - position.x, z: moving.position.z - position.z } : { x: 0, z: 0 }
      updateDraft(moving)
      return true
    }
    return false
  }
  function dragTo(position: { x: number; z: number }) {
    const current = draftRef.current
    if (current) updateDraft({ ...current, position: { ...current.position,
      x: position.x + dragOffset.current.x, z: position.z + dragOffset.current.z } })
  }
  function endDrag(position: { x: number; z: number } | null) {
    let current = draftRef.current
    if (!current) return
    if (position) current = { ...current, position: { ...current.position,
      x: position.x + dragOffset.current.x, z: position.z + dragOffset.current.z } }
    dragOrigin.current = null
    if (!current.movingId) { updateDraft(current); return }
    const issue = validatePlacement(current.model, current.position, instances, current.movingId)
    updateDraft(null)
    if (issue || unavailable) { setError(issue || 'Room data is unavailable. Refresh and try again.'); return }
    void mutate(() => actions.update(current.movingId!, current.furnitureId, current.position), () => {})
  }
  function cancelDrag() {
    const origin = dragOrigin.current
    dragOrigin.current = null
    if (!origin) return
    updateDraft(origin.movingId ? null : origin)
  }
  const preview = draft && room ? { name: draft.name, model: draft.model, placement: {
    id: 'preview', home_id: room.home.id, furniture_id: draft.furnitureId, ...draft.position,
  } } : null
  return <div className="room-workspace">
    {room && !instances.length && <span className="sr-only">The room is empty.</span>}
    {room?.warnings.map((warning, index) => <p role="status" className="floating-status" key={index}>{warning}</p>)}
    {busy && <p role="status" className="floating-status">Saving room changes…</p>}
    {error && <p role="alert" className="auth-error floating-status">{error}</p>}
    <SharedRoomScene instances={instances.filter(item => item.placement.id !== draft?.movingId)} selectedId={selectedId}
      preview={preview} previewInvalid={Boolean(invalid) || unavailable} disabled={blocked}
      onSelect={select} onDragStart={startDrag} onDrag={dragTo} onDragEnd={endDrag} onDragCancel={cancelDrag} />
    <div className="bottom-toolbar room-bottom-toolbar">
      {draft && !draft.movingId ? <>
        <button aria-label="Cancel placement" title="Cancel" onClick={cancelPlacement}><X aria-hidden="true" /></button>
        <button aria-label="Rotate preview 90 degrees" title="Rotate" onClick={rotateDraft}><RotateCw aria-hidden="true" /></button>
        <button aria-label="Confirm placement" title="Confirm" disabled={Boolean(invalid) || unavailable} onClick={confirmPlacement}><Check aria-hidden="true" /></button>
      </> : selected ? <>
        <button aria-label="Rotate selected furniture 90 degrees" title="Rotate" disabled={unavailable || removing} onClick={rotateSelected}><RotateCw aria-hidden="true" /></button>
        <button className="danger-button" aria-label="Remove selected furniture" title="Remove" onClick={() => setRemoving(true)}><Trash2 aria-hidden="true" /></button>
      </> : <button className="primary-wide" aria-label="Open furniture picker" title="Furniture" disabled={blocked} onClick={() => setPickerOpen(true)}><Armchair aria-hidden="true" /></button>}
    </div>
    {invalid && <p role="status" className="placement-feedback">{invalid}</p>}
    {pickerOpen && <div className="bottom-sheet furniture-sheet" role="dialog" aria-label="Choose furniture">
      <div className="sheet-heading sheet-heading-end"><button className="icon-button" aria-label="Close furniture picker" title="Close" onClick={() => setPickerOpen(false)}><X aria-hidden="true" /></button></div>
      {room?.furniture.length ? <div className="furniture-tray">{room.furniture.map(item => <button key={item.id}
        onClick={() => { setPickerOpen(false); chooseFurniture(item.id) }}><strong>{item.name}</strong><small>by {item.creator?.display_name ?? 'Unknown'}</small></button>)}</div>
        : <p>Your shared furniture library is empty.</p>}
    </div>}
    {removing && selected && <div className="bottom-sheet confirmation-sheet" role="dialog" aria-label="Remove placed furniture">
      <strong>Remove {selected.name ?? 'this furniture'}?</strong><p>The saved design stays in your library.</p>
      <div className="sheet-actions"><button className="icon-button" aria-label="Cancel removal" title="Cancel" onClick={() => setRemoving(false)}><X aria-hidden="true" /></button>
        <button className="icon-button danger-icon" aria-label="Confirm removal" title="Remove" onClick={() => void mutate(() => actions.remove(selected.placement.id), () => { setSelectedId(''); setRemoving(false) })}><Trash2 aria-hidden="true" /></button></div>
    </div>}
  </div>
}
