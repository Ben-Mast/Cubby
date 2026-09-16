import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { fetchCurrentHome } from '../home/currentHome'
import { createRefetchCoordinator, reconcileById, subscribeToHomeChanges } from '../../lib/supabase/realtime'
import { fetchSharedRoomForHome, type SharedRoomData } from './data'

export function useSharedRoom() {
  const { identity } = useAuth()
  const [data, setData] = useState<SharedRoomData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    let active = true
    let hasSnapshot = false
    let cleanup = () => {}
    setData(null); setError(''); setSyncError(''); setLoading(Boolean(identity))
    if (!identity) return () => { active = false }
    void fetchCurrentHome().then(home => {
      if (!active) return
      const coordinator = createRefetchCoordinator(
        () => fetchSharedRoomForHome(home),
        next => {
          hasSnapshot = true
          setData({ ...next, instances: reconcileById(next.instances, item => item.placement.id) })
          setError(''); setSyncError(''); setLoading(false)
        },
        reason => {
          const message = reason instanceof Error ? reason.message : 'Unable to load the room.'
          if (hasSnapshot) setSyncError(message); else setError(message)
          setLoading(false)
        },
      )
      const subscription = subscribeToHomeChanges('room', home.id, ['furniture', 'placed_furniture'],
        () => { setSyncError(''); void coordinator.request() },
        () => { setSyncError(''); void coordinator.request() },
        () => setSyncError('Live room updates are reconnecting. Refresh if changes do not appear.'),
      )
      cleanup = () => { coordinator.dispose(); void subscription.unsubscribe() }
      void coordinator.request()
    }).catch(reason => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : 'Unable to load the room.'); setLoading(false)
    })
    return () => { active = false; cleanup() }
  }, [identity?.id, attempt])
  return { data, loading, error, syncError, refresh }
}
