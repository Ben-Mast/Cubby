import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { applySurface } from './data'
import { useSurfaceLibrary } from './useSurfaceLibrary'
import type { SurfaceType } from './model'

export function RoomSurfacePicker({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { items, currentHome, loading, error, syncError, refresh } = useSurfaceLibrary()
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  async function choose(id: string | null, type: SurfaceType) {
    if (savingRef.current) return
    savingRef.current = true; setSaving(true); setActionError('')
    try { await applySurface(id, type); onApplied() }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Unable to apply surface.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const applied = (type: SurfaceType) => type === 'floor' ? currentHome?.floor_surface_id : currentHome?.wall_surface_id
  return <div className="bottom-sheet surface-room-sheet" role="dialog" aria-label="Choose room surfaces">
    <div className="sheet-heading"><strong>Room surfaces</strong>
      <button className="icon-button" aria-label="Close surface picker" title="Close" onClick={onClose}><X aria-hidden="true" /></button>
    </div>
    {loading && <p role="status">Loading surfaces…</p>}
    {error && <p role="alert" className="auth-error">{error} <button onClick={refresh}>Retry</button></p>}
    {syncError && <p role="status" className="auth-error">{syncError}</p>}
    {actionError && <p role="alert" className="auth-error">{actionError}</p>}
    {currentHome && (['floor', 'wall'] as const).map(type => <div className="surface-room-group" key={type}>
      <strong>{type === 'floor' ? 'Floor' : 'Walls'}</strong>
      <div className="furniture-tray surface-room-tray">
        <button aria-label={`Use default ${type}`} aria-pressed={!applied(type)} disabled={saving || !applied(type)}
          onClick={() => void choose(null, type)}>Default</button>
        {items.filter(item => item.type === type).map(item => <button key={item.id}
          aria-label={`Apply ${item.name} to ${type === 'floor' ? 'floor' : 'walls'}`}
          aria-pressed={applied(type) === item.id} disabled={saving || applied(type) === item.id}
          onClick={() => void choose(item.id, type)}><strong>{item.name}</strong><small>by {item.creator?.display_name ?? 'Unknown'}</small></button>)}
      </div>
    </div>)}
    {!loading && !error && !items.length && <p>No saved surfaces yet. <Link to="/surfaces">Open the surface library</Link> to create one.</p>}
  </div>
}
