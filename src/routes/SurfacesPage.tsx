import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { applySurface, deleteSurface } from '../features/surfaces/data'
import { useSurfaceLibrary } from '../features/surfaces/useSurfaceLibrary'
import type { SurfaceDesign, SurfaceType } from '../features/surfaces/model'
import { useHeaderAction } from '../app/AppShell'

export function SurfacesPage() {
  const { identity } = useAuth()
  return <SurfaceLibrary key={identity?.id} />
}
function SurfaceLibrary() {
  const { items, currentHome, loading, error, syncError, refresh } = useSurfaceLibrary()
  const setHeaderAction = useHeaderAction()
  const [pending, setPending] = useState<SurfaceDesign | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const lock = useRef(false)
  useEffect(() => {
    setHeaderAction({ content: <button className="nav-link nav-button" aria-label="Refresh surfaces" title="Refresh" disabled={loading || busy} onClick={refresh}><RefreshCw aria-hidden="true" /></button> })
    return () => setHeaderAction(null)
  }, [busy, loading, refresh, setHeaderAction])
  async function run(operation: () => Promise<void>, done: () => void) {
    if (lock.current) return
    lock.current = true; setBusy(true); setActionError('')
    try { await operation(); done(); refresh() }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Unable to save surface change.') }
    finally { lock.current = false; setBusy(false) }
  }
  const applied = (type: SurfaceType) => type === 'floor' ? currentHome?.floor_surface_id : currentHome?.wall_surface_id
  return <section className="page">
    <div className="page-actions"><Link className="icon-button primary-icon" aria-label="Create surface" title="Create surface" to="/surfaces/new"><Plus aria-hidden="true" /></Link></div>
    {loading && <p role="status">Loading surfaces…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {syncError && <p role="status" className="auth-error">{syncError}</p>}
    {actionError && <p role="alert" className="auth-error">{actionError}</p>}
    {currentHome && <div className="surface-default-actions">
      {(['floor', 'wall'] as const).map(type => <button key={type} disabled={busy || !applied(type)}
        onClick={() => void run(() => applySurface(null, type), () => {})}>Use default {type}</button>)}
    </div>}
    {!loading && !error && !items.length && <p>No surfaces yet.</p>}
    <ul className="furniture-list surface-list">{items.map(item => <li key={item.id}>
      <div><h2>{item.name}</h2><p>{item.type === 'floor' ? 'Floor' : 'Wall'} · {item.width}×{item.height} · Created by {item.creator?.display_name ?? 'Unknown creator'}
        {applied(item.type) === item.id ? ' · Applied' : ''}</p></div>
      <div className="icon-actions">
        <button className="icon-button primary-icon" aria-label={`Apply ${item.name} to ${item.type === 'floor' ? 'floor' : 'walls'}`} title="Apply"
          disabled={busy || applied(item.type) === item.id} onClick={() => void run(() => applySurface(item.id, item.type), () => {})}><Check aria-hidden="true" /></button>
        <Link className="icon-button" aria-label={`Edit ${item.name}`} title="Edit" to={`/surfaces/${item.id}/edit`}><Pencil aria-hidden="true" /></Link>
        <button className="icon-button danger-icon" aria-label={`Delete ${item.name}`} title="Delete" disabled={busy}
          onClick={() => setPending(item)}><Trash2 aria-hidden="true" /></button>
      </div>
    </li>)}</ul>
    {pending && <div className="delete-confirmation" role="dialog" aria-label={`Delete ${pending.name}`}>
      <h2>Delete “{pending.name}”?</h2>
      <p>{applied(pending.type) === pending.id ? 'This design is applied; its room surface will return to default. ' : ''}This cannot be undone.</p>
      <div className="icon-actions">
        <button className="icon-button danger-icon" aria-label="Confirm surface deletion" disabled={busy}
          onClick={() => void run(() => deleteSurface(pending.id), () => setPending(null))}><Trash2 aria-hidden="true" /></button>
        <button className="icon-button" aria-label="Cancel surface deletion" disabled={busy} onClick={() => setPending(null)}><X aria-hidden="true" /></button>
      </div>
    </div>}
  </section>
}
