import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, HousePlus, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { countPlacedInstances, deleteFurniture, PlacementCountChangedError, type FurnitureSummary } from '../features/furniture/data'
import { useFurnitureLibrary } from '../features/furniture/useFurnitureLibrary'
import { FurnitureThumbnail } from '../features/furniture/FurnitureThumbnail'
import { useHeaderAction } from '../app/AppShell'

export function FurniturePage() {
  const { identity } = useAuth()
  return <FurnitureLibrary key={identity?.id} />
}
function FurnitureLibrary() {
  const { items, loading, error, syncError, refresh } = useFurnitureLibrary()
  const setHeaderAction = useHeaderAction()
  const [pending, setPending] = useState<{ item: FurnitureSummary; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  const confirmation = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setHeaderAction({ content: <button className="nav-link nav-button" aria-label="Refresh furniture" title="Refresh" disabled={loading || busy || Boolean(pending)} onClick={refresh}><RefreshCw aria-hidden="true" /></button> })
    return () => setHeaderAction(null)
  }, [busy, loading, pending, refresh, setHeaderAction])
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => { if (pending) confirmation.current?.focus() }, [pending])
  async function prepare(item: FurnitureSummary) {
    if (lock.current) return
    lock.current = true; setBusy(true); setDeleteError('')
    try {
      const count = await countPlacedInstances(item.id)
      if (active.current) setPending({ item, count })
    } catch (reason) { if (active.current) setDeleteError(reason instanceof Error ? reason.message : 'Unable to check deletion.') }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  async function confirm() {
    if (!pending || lock.current) return
    lock.current = true; setBusy(true); setDeleteError('')
    try {
      await deleteFurniture(pending.item.id, pending.count)
      if (active.current) { setPending(null); refresh() }
    } catch (reason) {
      if (active.current) {
        if (reason instanceof PlacementCountChangedError) setPending({ ...pending, count: reason.count })
        setDeleteError(reason instanceof Error ? reason.message : 'Unable to delete furniture.')
      }
    } finally { lock.current = false; if (active.current) setBusy(false) }
  }
  return <section className="page">
    <div className="page-actions"><Link className="icon-button primary-icon" aria-label="Create furniture" title="Create furniture" to="/furniture/new"><Plus aria-hidden="true" /></Link></div>
    {loading && <p role="status">Loading furniture…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {syncError && <p role="status" className="auth-error">{syncError}</p>}
    {!loading && !error && !items.length && <p>No furniture yet.</p>}
    <ul className="furniture-list">{items.map(item => <li key={item.id}>
      <FurnitureThumbnail path={item.thumbnail_path} name={item.name} />
      <div className="library-card-details"><h2>{item.name}</h2><p>Created by {item.creator?.display_name ?? 'Unknown creator'}</p></div>
      <div className="icon-actions"><Link className="icon-button" aria-label={`Edit ${item.name}`} title="Edit" to={`/furniture/${item.id}/edit`}><Pencil aria-hidden="true" /></Link>
        <Link className="icon-button primary-icon" aria-label={`Place ${item.name} in room`} title="Place in room" to={`/room?place=${encodeURIComponent(item.id)}`}><HousePlus aria-hidden="true" /></Link>
        <button className="icon-button danger-icon" aria-label={`Delete ${item.name}`} title="Delete" disabled={busy || Boolean(pending)} onClick={() => void prepare(item)}><Trash2 aria-hidden="true" /></button></div>
    </li>)}</ul>
    {pending && <div ref={confirmation} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="delete-heading" className="delete-confirmation">
      <h2 id="delete-heading">Delete “{pending.item.name}”?</h2>
      <p>{pending.count ? `Deleting this furniture will also remove ${pending.count} placed ${pending.count === 1 ? 'copy' : 'copies'} from the room.` : 'This furniture has no placed copies.'} This cannot be undone.</p>
      <div className="icon-actions"><button className="icon-button danger-icon" aria-label={busy ? 'Deleting furniture' : 'Confirm delete'} title="Confirm delete" disabled={busy} onClick={() => void confirm()}><Check aria-hidden="true" /></button>
        <button className="icon-button" aria-label="Cancel delete" title="Cancel" disabled={busy} onClick={() => { setPending(null); setDeleteError('') }}><X aria-hidden="true" /></button></div>
    </div>}
    {busy && !pending && <p role="status">Checking placed copies…</p>}
    {deleteError && <p role="alert" className="auth-error">{deleteError}</p>}
  </section>
}
