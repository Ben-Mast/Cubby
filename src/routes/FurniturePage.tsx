import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import { countPlacedInstances, deleteFurniture, PlacementCountChangedError, type FurnitureSummary } from '../features/furniture/data'
import { useFurnitureLibrary } from '../features/furniture/useFurnitureLibrary'

export function FurniturePage() {
  const { identity } = useAuth()
  return <FurnitureLibrary key={identity?.id} />
}
function FurnitureLibrary() {
  const { items, loading, error, syncError, refresh } = useFurnitureLibrary()
  const [pending, setPending] = useState<{ item: FurnitureSummary; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  const confirmation = useRef<HTMLDivElement>(null)
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
    <div className="page-heading"><div><p className="eyebrow">Furniture</p><h1>Shared furniture library</h1></div></div>
    <div className="editor-toolbar"><Link className="button-link" to="/furniture/new">Create Furniture</Link>
      <button disabled={loading || busy || Boolean(pending)} onClick={refresh}>Refresh library</button></div>
    {loading && <p role="status">Loading furniture…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {syncError && <p role="status" className="auth-error">{syncError}</p>}
    {!loading && !error && !items.length && <p>No furniture yet. Create your first design.</p>}
    <ul className="furniture-list">{items.map(item => <li key={item.id}>
      <div><h2>{item.name}</h2><p>Created by {item.creator?.display_name ?? 'Unknown creator'}</p></div>
      <div className="editor-toolbar"><Link className="button-link" to={`/furniture/${item.id}/edit`}>Edit</Link>
        <Link className="button-link" to={`/room?place=${encodeURIComponent(item.id)}`}>Place in Room</Link>
        <button disabled={busy || Boolean(pending)} onClick={() => void prepare(item)}>Delete</button></div>
    </li>)}</ul>
    {pending && <div ref={confirmation} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="delete-heading" className="delete-confirmation">
      <h2 id="delete-heading">Delete “{pending.item.name}”?</h2>
      <p>{pending.count ? `Deleting this furniture will also remove ${pending.count} placed ${pending.count === 1 ? 'copy' : 'copies'} from the room.` : 'This furniture has no placed copies.'} This cannot be undone.</p>
      <div className="editor-toolbar"><button disabled={busy} onClick={() => void confirm()}>{busy ? 'Deleting…' : 'Confirm delete'}</button>
        <button disabled={busy} onClick={() => { setPending(null); setDeleteError('') }}>Cancel</button></div>
    </div>}
    {busy && !pending && <p role="status">Checking placed copies…</p>}
    {deleteError && <p role="alert" className="auth-error">{deleteError}</p>}
  </section>
}
