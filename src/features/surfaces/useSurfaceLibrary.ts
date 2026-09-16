import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { fetchCurrentHome } from '../home/currentHome'
import type { SharedHome } from '../home/currentHome'
import { createRefetchCoordinator, reconcileById, subscribeToHomeChanges } from '../../lib/supabase/realtime'
import { listSurfacesForHome } from './data'
import type { SurfaceDesign } from './model'

export function useSurfaceLibrary() {
  const { identity } = useAuth()
  const [items, setItems] = useState<SurfaceDesign[]>([])
  const [currentHome, setCurrentHome] = useState<SharedHome | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    let active = true, hasSnapshot = false
    let cleanup = () => {}
    setItems([]); setCurrentHome(null); setLoading(Boolean(identity)); setError(''); setSyncError('')
    if (!identity) return () => { active = false }
    void fetchCurrentHome().then(home => {
      if (!active) return
      const coordinator = createRefetchCoordinator(
        async () => ({ rows: await listSurfacesForHome(home.id), home: await fetchCurrentHome() }),
        ({ rows, home }) => { hasSnapshot = true; setItems(reconcileById(rows, item => item.id)); setCurrentHome(home); setLoading(false); setError(''); setSyncError('') },
        reason => { const message = reason instanceof Error ? reason.message : 'Unable to load surfaces.'
          if (hasSnapshot) setSyncError(message); else setError(message); setLoading(false) },
      )
      const subscription = subscribeToHomeChanges('surfaces', home.id, ['surfaces', 'homes'],
        () => { setSyncError(''); void coordinator.request() },
        () => { setSyncError(''); void coordinator.request() },
        () => setSyncError('Live surface updates are reconnecting. Refresh if changes do not appear.'),
      )
      cleanup = () => { coordinator.dispose(); void subscription.unsubscribe() }
      void coordinator.request()
    }).catch(reason => { if (active) { setError(reason instanceof Error ? reason.message : 'Unable to load surfaces.'); setLoading(false) } })
    return () => { active = false; cleanup() }
  }, [identity?.id, attempt])
  return { items, currentHome, loading, error, syncError, refresh }
}
