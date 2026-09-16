import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, create } from 'react-test-renderer'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { identities } from '../src/features/auth/identities'
import { useFurnitureLibrary } from '../src/features/furniture/useFurnitureLibrary'
import { useSharedRoom } from '../src/features/room/useSharedRoom'
import { createRefetchCoordinator, reconcileById, subscribeToHomeChanges } from '../src/lib/supabase/realtime'
import { mock } from './mockSupabase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const voxelData = { version: 1, size: [16,16,16], voxels: [{ x: 0,y: 0,z: 0,color: '#ffffff' }] }
function furniture(id: string, name: string, color = '#ffffff') {
  return { id,home_id: 'shared-home',creator_id: 'user-one',name,created_at: '2026-01-01',updated_at: '2026-01-01',
    voxel_data: { ...voxelData,voxels: [{ ...voxelData.voxels[0],color }] } }
}
function signIn() { mock.session = { user: { id: 'user-one',email: identities[0].email } } }
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function LibraryProbe() {
  const state = useFurnitureLibrary()
  return <div data-sync={state.syncError}>{state.loading ? 'loading' : state.items.map(item => `${item.id}:${item.name}`).join('|')}</div>
}
function RoomProbe() {
  const state = useSharedRoom()
  return <div data-sync={state.syncError}>{state.loading ? 'loading' : state.data?.instances.map(item =>
    `${item.placement.id}:${item.placement.x}:${item.placement.rotation}:${item.model.voxels[0].color}`).join('|')}</div>
}
function RoomControlProbe({ observe }: { observe: (state: ReturnType<typeof useSharedRoom>) => void }) {
  const state = useSharedRoom()
  observe(state)
  return <div>{state.loading ? 'loading' : state.data?.instances.map(item =>
    `${item.placement.id}:${item.placement.x}`).join('|')}</div>
}

test('home subscription scopes inserts/updates, handles deletes, reconnects, and removes exactly once', async () => {
  mock.reset()
  let changes = 0, reconnects = 0, errors = 0
  const subscription = subscribeToHomeChanges('test','shared-home',['furniture'],() => changes++,() => reconnects++,() => errors++)
  await settle()
  assert.equal(mock.channels.size,1); assert.equal(reconnects,0)
  const channel: any = [...mock.channels][0]
  assert.equal(channel.bindings.length,3)
  assert.equal(channel.bindings.find((item: any) => item.filter.event === 'INSERT').filter.filter,'home_id=eq.shared-home')
  assert.equal(channel.bindings.find((item: any) => item.filter.event === 'DELETE').filter.filter,undefined)
  mock.emitRealtime('furniture','INSERT',{ id: 'a',home_id: 'other-home' })
  mock.emitRealtime('furniture','INSERT',{ id: 'a',home_id: 'shared-home' })
  mock.emitRealtime('furniture','UPDATE',{ id: 'a',home_id: 'shared-home' })
  mock.emitRealtime('furniture','DELETE',{ id: 'a' })
  assert.equal(changes,3)
  mock.emitRealtimeStatus('CHANNEL_ERROR'); assert.equal(errors,1)
  mock.emitRealtimeStatus('SUBSCRIBED'); assert.equal(reconnects,1)
  await subscription.unsubscribe(); await subscription.unsubscribe()
  assert.equal(mock.channels.size,0)
  mock.emitRealtime('furniture','INSERT',{ id: 'b',home_id: 'shared-home' }); assert.equal(changes,3)
})

test('coordinator serializes event bursts, reruns after an in-flight change, and ID reconciliation deduplicates', async () => {
  let fetches = 0, resolveFirst: (value: string[]) => void = () => {}, applied: string[][] = []
  const coordinator = createRefetchCoordinator(() => {
    fetches++
    if (fetches === 1) return new Promise<string[]>(resolve => { resolveFirst = resolve })
    return Promise.resolve(['new'])
  }, value => applied.push(value), () => assert.fail('unexpected fetch failure'))
  void coordinator.request(); void coordinator.request(); void coordinator.request()
  assert.equal(fetches,1)
  resolveFirst(['old']); await settle()
  assert.equal(fetches,2); assert.deepEqual(applied,[['old'],['new']])
  assert.deepEqual(reconcileById([{ id: 'a',v: 1 },{ id: 'a',v: 2 },{ id: 'b',v: 3 }], item => item.id),
    [{ id: 'a',v: 2 },{ id: 'b',v: 3 }])
  coordinator.dispose()
})

test('furniture INSERT/UPDATE/DELETE and local echoes reconcile live without duplicate rows', async () => {
  mock.reset(); signIn(); mock.furniture.set('a',furniture('a','Chair'))
  let renderer: any
  await act(async () => { renderer = create(<AuthProvider><LibraryProbe /></AuthProvider>); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/a:Chair/); assert.equal(mock.channels.size,1)
  mock.furniture.set('b',furniture('b','Table'))
  await act(async () => { mock.emitRealtime('furniture','INSERT',mock.furniture.get('b')); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/b:Table/)
  mock.furniture.set('b',{ ...mock.furniture.get('b'),name: 'Desk' })
  await act(async () => { mock.emitRealtime('furniture','UPDATE',mock.furniture.get('b')); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/b:Desk/)
  await act(async () => { mock.emitRealtime('furniture','UPDATE',mock.furniture.get('b')); await settle() })
  assert.equal((JSON.stringify(renderer.toJSON()).match(/b:Desk/g) ?? []).length,1)
  mock.furniture.delete('a')
  await act(async () => { mock.emitRealtime('furniture','DELETE',{ id: 'a' }); await settle() })
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/a:Chair/)
  mock.furniture.set('c',furniture('c','Lamp'))
  await act(async () => { mock.emitRealtimeStatus('CHANNEL_ERROR'); await settle() })
  assert.match(renderer.root.findByType('div').props['data-sync'],/reconnecting/)
  await act(async () => { mock.emitRealtimeStatus('SUBSCRIBED'); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/c:Lamp/)
  await act(async () => renderer.unmount())
  assert.equal(mock.channels.size,0)
})

test('room reacts to placement CRUD and furniture definition edits without duplicates', async () => {
  mock.reset(); signIn(); mock.furniture.set('design',furniture('design','Chair'))
  const placed = { id: 'placed',home_id: 'shared-home',furniture_id: 'design',x: 2,y: 0,z: 3,rotation: 0 }
  mock.placements = [placed]
  let renderer: any
  await act(async () => { renderer = create(<AuthProvider><RoomProbe /></AuthProvider>); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/placed:2:0:#ffffff/); assert.equal(mock.channels.size,1)
  mock.placements[0] = { ...placed,x: 8,rotation: 90 }
  await act(async () => { mock.emitRealtime('placed_furniture','UPDATE',mock.placements[0]); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/placed:8:90:#ffffff/)
  await act(async () => { mock.emitRealtime('placed_furniture','UPDATE',mock.placements[0]); await settle() })
  assert.equal((JSON.stringify(renderer.toJSON()).match(/placed:8:90/g) ?? []).length,1)
  mock.furniture.set('design',furniture('design','Chair','#ff00ff'))
  await act(async () => { mock.emitRealtime('furniture','UPDATE',mock.furniture.get('design')); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/#ff00ff/)
  mock.placements.push({ ...placed,id: 'second',x: 12,z: 12 })
  await act(async () => { mock.emitRealtime('placed_furniture','INSERT',mock.placements[1]); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/second:12:0/)
  mock.placements = mock.placements.filter(item => item.id !== 'placed')
  await act(async () => { mock.emitRealtime('placed_furniture','DELETE',{ id: 'placed' }); await settle() })
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/placed:/)
  mock.placements[0] = { ...mock.placements[0],x: 10 }
  await act(async () => { mock.emitRealtimeStatus('SUBSCRIBED'); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()),/second:10:0/)
  mock.furniture.delete('design'); mock.placements = []
  await act(async () => { mock.emitRealtime('furniture','DELETE',{ id: 'design' }); await settle() })
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/second:/)
  await act(async () => renderer.unmount())
  assert.equal(mock.channels.size,0)
})

test('room dimensions refetch from the shared home after realtime resize', async () => {
  mock.reset(); signIn()
  let latest: ReturnType<typeof useSharedRoom> | null = null
  let renderer: any
  await act(async () => { renderer = create(<AuthProvider><RoomControlProbe observe={state => { latest = state }} /></AuthProvider>); await settle() })
  assert.equal(latest!.data!.home.width, 64)
  mock.home = { ...mock.home, width: 80, depth: 72, height: 20 }
  await act(async () => { mock.emitRealtime('homes', 'UPDATE', mock.home); await settle() })
  assert.deepEqual([latest!.data!.home.width, latest!.data!.home.depth, latest!.data!.home.height], [80, 72, 20])
  assert.equal(mock.channels.size, 1)
  await act(async () => renderer.unmount())
})

test('room placement realtime events reconcile by ID without reloading the room snapshot', async () => {
  mock.reset(); signIn(); mock.furniture.set('design', furniture('design', 'Chair'))
  mock.placements = [{ id: 'placed', home_id: 'shared-home', furniture_id: 'design', x: 2, y: 0, z: 3,
    rotation: 0, updated_at: '2026-01-01T00:00:00Z' }]
  let renderer: any
  await act(async () => { renderer = create(<AuthProvider><RoomProbe /></AuthProvider>); await settle() })
  const reads = () => mock.queryCalls.filter(call => call.table === 'placed_furniture' && call.operation === 'select').length
  const initialReads = reads()
  mock.placements[0] = { ...mock.placements[0], x: 5, updated_at: '2026-01-02T00:00:00Z' }
  await act(async () => { mock.emitRealtime('placed_furniture', 'UPDATE', mock.placements[0]); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()), /placed:5/)
  assert.equal(reads(), initialReads)
  await act(async () => { mock.emitRealtime('placed_furniture', 'UPDATE', {
    ...mock.placements[0], x: 2, updated_at: '2026-01-01T00:00:00Z',
  }); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()), /placed:5/, 'late older echo cannot reverse a newer position')
  mock.placements.push({ ...mock.placements[0], id: 'second', x: 9 })
  await act(async () => { mock.emitRealtime('placed_furniture', 'INSERT', mock.placements[1]); await settle() })
  await act(async () => { mock.emitRealtime('placed_furniture', 'INSERT', mock.placements[1]); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()), /second:9/)
  assert.equal((JSON.stringify(renderer.toJSON()).match(/second:9/g) ?? []).length, 1)
  assert.equal(reads(), initialReads)
  mock.placements = mock.placements.filter(item => item.id !== 'placed')
  await act(async () => { mock.emitRealtime('placed_furniture', 'DELETE', { id: 'placed' }); await settle() })
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /placed:/)
  assert.equal(reads(), initialReads)
  await act(async () => renderer.unmount())
})

test('manual background refresh retains room state and ignores a snapshot made stale by a local save', async () => {
  mock.reset(); signIn(); mock.furniture.set('design', furniture('design', 'Chair'))
  const old = { id: 'placed', home_id: 'shared-home', furniture_id: 'design', x: 2, y: 0, z: 3,
    rotation: 0 as const, updated_at: '2026-01-01T00:00:00Z' }
  mock.placements = [old]
  let latest: ReturnType<typeof useSharedRoom> | null = null
  const history: string[] = []
  let renderer: any
  await act(async () => { renderer = create(<AuthProvider><RoomControlProbe observe={state => {
    latest = state; history.push(state.data?.instances.map(item => `${item.placement.id}:${item.placement.x}`).join('|') ?? 'empty')
  }} /></AuthProvider>); await settle() })
  assert.match(JSON.stringify(renderer.toJSON()), /placed:2/)
  let release: () => void = () => {}
  mock.roomReadGate = new Promise<void>(resolve => { release = resolve })
  await act(async () => latest!.refresh())
  assert.equal(latest!.loading, false)
  assert.match(JSON.stringify(renderer.toJSON()), /placed:2/)
  const model = latest!.data!.instances[0].model
  const saved = { ...old, x: 8, updated_at: '2026-01-02T00:00:00Z' }
  mock.placements = [saved]
  await act(async () => latest!.upsertPlacement({ placement: saved, model, name: 'Chair' }))
  const afterSave = history.length
  assert.match(JSON.stringify(renderer.toJSON()), /placed:8/)
  await act(async () => { release(); await settle() })
  assert.ok(history.slice(afterSave).every(value => value === 'placed:8'), 'stale snapshot never flashes the old position')
  assert.equal(mock.channels.size, 1, 'background refresh retains the existing subscription')
  await act(async () => renderer.unmount())
})

test('two mounted room clients converge through realtime after a local update and removal', async () => {
  mock.reset(); signIn(); mock.furniture.set('design', furniture('design', 'Chair'))
  const placed = { id: 'placed', home_id: 'shared-home', furniture_id: 'design', x: 2, y: 0, z: 3,
    rotation: 0 as const, updated_at: '2026-01-01T00:00:00Z' }
  mock.placements = [placed]
  let first: ReturnType<typeof useSharedRoom> | null = null
  let second: ReturnType<typeof useSharedRoom> | null = null
  let renderer: any
  await act(async () => { renderer = create(<AuthProvider>
    <RoomControlProbe observe={state => { first = state }} />
    <RoomControlProbe observe={state => { second = state }} />
  </AuthProvider>); await settle() })
  assert.equal(mock.channels.size, 2)
  const moved = { ...placed, x: 8, y: 2, updated_at: '2026-01-02T00:00:00Z' }
  mock.placements = [moved]
  await act(async () => first!.upsertPlacement({ ...first!.data!.instances[0], placement: moved }))
  assert.equal(first!.data!.instances[0].placement.x, 8)
  assert.equal(second!.data!.instances[0].placement.x, 2)
  await act(async () => { mock.emitRealtime('placed_furniture', 'UPDATE', moved); await settle() })
  assert.equal(second!.data!.instances[0].placement.x, 8)
  assert.equal(second!.data!.instances[0].placement.y, 2)
  assert.equal(first!.data!.instances.length, 1)
  mock.placements = []
  await act(async () => first!.removePlacement('placed'))
  await act(async () => { mock.emitRealtime('placed_furniture', 'DELETE', { id: 'placed' }); await settle() })
  assert.equal(first!.data!.instances.length, 0)
  assert.equal(second!.data!.instances.length, 0)
  await act(async () => renderer.unmount())
  assert.equal(mock.channels.size, 0)
})

test('auth identity changes dispose the old home subscription before creating another', async () => {
  mock.reset(); signIn()
  let renderer: any
  await act(async () => { renderer = create(<AuthProvider><LibraryProbe /></AuthProvider>); await settle() })
  const oldChannel = [...mock.channels][0]
  await act(async () => { mock.emit({ user: { id: 'user-two',email: identities[1].email } }); await settle() })
  assert.equal(mock.channels.has(oldChannel),false)
  assert.equal(mock.channels.size,1)
  await act(async () => renderer.unmount())
  assert.equal(mock.channels.size,0)
})
