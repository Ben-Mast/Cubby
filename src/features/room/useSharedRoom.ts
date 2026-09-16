import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { fetchCurrentHome } from '../home/currentHome'
import { getFurnitureDefinitions } from '../furniture/data'
import { createRefetchCoordinator, reconcileById, subscribeToHomeChanges, type HomeChange } from '../../lib/supabase/realtime'
import { fetchSharedRoomForHome, type SharedRoomData } from './data'
import { reconstructRoomModel, roomTransform, type PlacedFurniture, type RoomInstance, type RoomModel } from './model'

function isPlacement(value: Record<string, unknown>): value is Record<string, unknown> & PlacedFurniture {
  return typeof value.id === 'string' && typeof value.home_id === 'string' && typeof value.furniture_id === 'string'
    && Number.isInteger(value.x) && Number.isInteger(value.y) && Number.isInteger(value.z)
    && [0, 90, 180, 270].includes(value.rotation as number)
}

function upsertRoomInstance(items: readonly RoomInstance[], incoming: RoomInstance): RoomInstance[] {
  const index = items.findIndex(item => item.placement.id === incoming.placement.id)
  if (index < 0) return [...items, incoming]
  const current = items[index]
  if (current.placement.updated_at && incoming.placement.updated_at
    && current.placement.updated_at > incoming.placement.updated_at) return [...items]
  const next = [...items]
  next[index] = incoming
  return next
}

export function useSharedRoom() {
  const { identity } = useAuth()
  const [data, setData] = useState<SharedRoomData | null>(null)
  const dataRef = useRef<SharedRoomData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const requestRef = useRef<(() => void) | null>(null)
  const versionRef = useRef(0)

  const publish = useCallback((next: SharedRoomData | null) => {
    dataRef.current = next
    setData(next)
  }, [])
  const upsertPlacement = useCallback((instance: RoomInstance) => {
    const current = dataRef.current
    if (!current || instance.placement.home_id !== current.home.id) return
    versionRef.current++
    publish({ ...current, instances: upsertRoomInstance(current.instances, instance) })
  }, [publish])
  const removePlacement = useCallback((id: string) => {
    const current = dataRef.current
    if (!current) return
    versionRef.current++
    publish({ ...current, instances: current.instances.filter(item => item.placement.id !== id) })
  }, [publish])
  const refresh = useCallback(() => {
    if (requestRef.current) requestRef.current()
    else setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    let hasSnapshot = false
    let cleanup = () => {}
    requestRef.current = null
    publish(null); setError(''); setSyncError(''); setLoading(Boolean(identity))
    if (!identity) return () => { active = false }
    void fetchCurrentHome().then(home => {
      if (!active) return
      const models = new Map<string, { model: RoomModel; name?: string }>()
      const eventSequence = new Map<string, number>()
      const coordinator = createRefetchCoordinator(
        async () => {
          const version = versionRef.current
          return { room: await fetchSharedRoomForHome(home), version }
        },
        ({ room, version }) => {
          if (version !== versionRef.current) { void coordinator.request(); return }
          hasSnapshot = true
          room.instances = reconcileById(room.instances, item => item.placement.id)
          models.clear()
          for (const item of room.instances) models.set(item.placement.furniture_id, { model: item.model, name: item.name })
          publish(room)
          setError(''); setSyncError(''); setLoading(false)
        },
        reason => {
          const message = reason instanceof Error ? reason.message : 'Unable to load the room.'
          if (hasSnapshot) setSyncError(message); else setError(message)
          setLoading(false)
        },
      )
      requestRef.current = () => { void coordinator.request() }
      async function applyPlacement(change: HomeChange) {
        const row = change.new
        if (!isPlacement(row) || row.home_id !== home.id) { void coordinator.request(); return }
        const sequence = (eventSequence.get(row.id) ?? 0) + 1
        eventSequence.set(row.id, sequence)
        try {
          let definition = models.get(row.furniture_id)
          if (!definition) {
            const [record] = await getFurnitureDefinitions(home.id, [row.furniture_id])
            if (!record) { void coordinator.request(); return }
            definition = { model: reconstructRoomModel(record.voxel_data), name: record.name }
            models.set(row.furniture_id, definition)
          }
          if (!active || eventSequence.get(row.id) !== sequence) return
          roomTransform(row, definition.model)
          upsertPlacement({ placement: row, ...definition })
        } catch { if (active) void coordinator.request() }
      }
      const subscription = subscribeToHomeChanges('room', home.id, ['furniture', 'placed_furniture'], change => {
        if (change.table === 'furniture') { void coordinator.request(); return }
        if (change.eventType === 'DELETE') {
          if (typeof change.old.id === 'string') {
            eventSequence.set(change.old.id, (eventSequence.get(change.old.id) ?? 0) + 1)
            removePlacement(change.old.id)
          } else void coordinator.request()
          return
        }
        if (!dataRef.current) { void coordinator.request(); return }
        void applyPlacement(change)
      },
      () => { setSyncError(''); void coordinator.request() },
      () => setSyncError('Live room updates are reconnecting. Refresh if changes do not appear.'))
      cleanup = () => { requestRef.current = null; coordinator.dispose(); void subscription.unsubscribe() }
      void coordinator.request()
    }).catch(reason => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : 'Unable to load the room.'); setLoading(false)
    })
    return () => { active = false; cleanup() }
  }, [identity?.id, attempt, publish, removePlacement, upsertPlacement])

  return { data, loading, error, syncError, refresh, upsertPlacement, removePlacement }
}
