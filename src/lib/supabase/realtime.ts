// Keep the standard client import suffix so the isolated test boundary can
// substitute the same Supabase mock used by every data-access module.
import { supabase } from '../../lib/supabase/client'

export type SharedTable = 'furniture' | 'placed_furniture'
export interface HomeSubscription { unsubscribe: () => Promise<void> }
let channelSequence = 0

/** One channel owns all events needed by a mounted shared-home view. */
export function subscribeToHomeChanges(
  scope: string, homeId: string, tables: readonly SharedTable[], onChange: () => void,
  onReconnect: () => void, onStatusError: () => void,
): HomeSubscription {
  let active = true
  let subscribedOnce = false
  const channel = supabase.channel(`cubby:${scope}:${homeId}:${++channelSequence}`)
  for (const table of tables) {
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: `home_id=eq.${homeId}` }, onChange)
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `home_id=eq.${homeId}` }, onChange)
    // Postgres Changes cannot reliably filter DELETE payloads. Consumers only
    // reconcile IDs from their authoritative, RLS-scoped snapshot.
    channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, onChange)
  }
  channel.subscribe(status => {
    if (!active) return
    if (status === 'SUBSCRIBED') {
      if (subscribedOnce) onReconnect()
      subscribedOnce = true
    }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatusError()
  })
  return { async unsubscribe() {
    if (!active) return
    active = false
    await supabase.removeChannel(channel)
  } }
}

/** Coalesces bursts and guarantees an event received during a fetch gets a later fetch. */
export function createRefetchCoordinator<T>(fetcher: () => Promise<T>, apply: (value: T) => void, fail: (reason: unknown) => void) {
  let active = true
  let running = false
  let requested = false
  async function request() {
    requested = true
    if (running) return
    running = true
    while (active && requested) {
      requested = false
      try { const value = await fetcher(); if (active) apply(value) }
      catch (reason) { if (active) fail(reason) }
    }
    running = false
  }
  return { request, dispose: () => { active = false; requested = false } }
}

export function reconcileById<T>(incoming: readonly T[], id: (item: T) => string): T[] {
  const unique = new Map<string, T>()
  for (const item of incoming) unique.set(id(item), item)
  return [...unique.values()]
}
