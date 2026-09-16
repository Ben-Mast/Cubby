import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { fetchCurrentHome } from '../home/currentHome'
import { createRefetchCoordinator, reconcileById, subscribeToHomeChanges } from '../../lib/supabase/realtime'
import { listFurnitureForHome, type FurnitureSummary } from './data'
export function useFurnitureLibrary() {
  const { identity } = useAuth()
  const [items, setItems] = useState<FurnitureSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let hasSnapshot = false
    let cleanup = () => {}
    setItems([]); setLoading(Boolean(identity)); setError(''); setSyncError('')
    if (!identity) return () => { active = false }
    void fetchCurrentHome().then(home => {
      if (!active) return
      const coordinator = createRefetchCoordinator(
        () => listFurnitureForHome(home.id),
        rows => {
          hasSnapshot = true
          setItems(reconcileById(rows, item => item.id))
          setError(''); setSyncError(''); setLoading(false)
        },
        reason => {
          const message = reason instanceof Error ? reason.message : 'Unable to load furniture.'
          if (hasSnapshot) setSyncError(message); else setError(message)
          setLoading(false)
        },
      )
      const subscription = subscribeToHomeChanges('library', home.id, ['furniture'],
        () => { setSyncError(''); void coordinator.request() },
        () => { setSyncError(''); void coordinator.request() },
        () => setSyncError('Live furniture updates are reconnecting. Refresh if changes do not appear.'),
      )
      cleanup = () => { coordinator.dispose(); void subscription.unsubscribe() }
      void coordinator.request()
    }).catch(reason => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : 'Unable to load furniture.'); setLoading(false)
    })
    return () => { active = false; cleanup() }
  }, [identity?.id, attempt])
  return { items, loading, error, syncError, refresh: () => setAttempt(value => value + 1) }
}
