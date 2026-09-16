import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4, Vector3 } from 'three'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/app/App'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { identities } from '../src/features/auth/identities'
import { fetchSharedRoom } from '../src/features/room/data'
import { reconstructRoomModel, roomTransform, type PlacedFurniture, type RoomRotation } from '../src/features/room/model'
import { ROOM_WIDTH, ROOM_DEPTH, VOXEL_UNIT } from '../src/features/room/config'
import { createFurniture, updateFurniture } from '../src/features/furniture/data'
import { editModel, type VoxelData } from '../src/features/voxel/model'
import { mock } from './mockSupabase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const voxelData: VoxelData = { version: 1, size: [16,16,16], voxels: [
  { x: 4, y: 6, z: 9, color: '#8b5e3c' }, { x: 7, y: 8, z: 10, color: '#ffffff' },
] }
const placement = (rotation: RoomRotation): PlacedFurniture => ({ id: `instance-${rotation}`, home_id: 'shared-home', furniture_id: 'design', x: 3, z: 5, rotation })
function signIn() { mock.session = { user: { id: 'user-one', email: identities[0].email } } }

test('all orthogonal rotations anchor cube bounds at x/z and lowest voxel on floor', () => {
  const model = reconstructRoomModel(voxelData)
  for (const rotation of [0, 90, 180, 270] as const) {
    const at = placement(rotation)
    const transform = roomTransform(at, model)
    const matrix = new Matrix4().makeTranslation(...transform.position)
      .multiply(new Matrix4().makeRotationY(transform.rotation))
      .multiply(new Matrix4().makeScale(transform.scale, transform.scale, transform.scale))
    const corners: Vector3[] = []
    for (const voxel of model.voxels) for (const x of [voxel.x, voxel.x + 1])
      for (const y of [voxel.y, voxel.y + 1]) for (const z of [voxel.z, voxel.z + 1]) corners.push(new Vector3(x,y,z).applyMatrix4(matrix))
    const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
    near(Math.min(...corners.map(point => point.x)), at.x - ROOM_WIDTH / 2)
    near(Math.min(...corners.map(point => point.z)), at.z - ROOM_DEPTH / 2)
    near(Math.min(...corners.map(point => point.y)), 0)
    near(Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x)), (rotation % 180 === 0 ? 4 : 2) * VOXEL_UNIT)
    near(Math.max(...corners.map(point => point.z)) - Math.min(...corners.map(point => point.z)), (rotation % 180 === 0 ? 2 : 4) * VOXEL_UNIT)
  }
  assert.throws(() => reconstructRoomModel({ version: 1, size: [16,16,16], voxels: [] }))
  assert.throws(() => roomTransform({ ...placement(0), rotation: 45 as RoomRotation }, model))
})
test('empty room resolves home and skips furniture lookup; anonymous reads fail', async () => {
  mock.reset(); signIn()
  const data = await fetchSharedRoom()
  assert.equal(data.home.id, 'shared-home'); assert.deepEqual(data.instances, []); assert.deepEqual(data.warnings, [])
  assert.equal(mock.queryCalls.some(call => call.table === 'furniture'), false)
  mock.session = null; await assert.rejects(fetchSharedRoom, /Sign in/)
})
test('room reads only referenced same-home definitions and reconstructs once per design', async () => {
  mock.reset(); signIn()
  mock.furniture.set('design', { id: 'design', home_id: 'shared-home', name: 'Chair', voxel_data: voxelData })
  mock.furniture.set('unreferenced', { id: 'unreferenced', home_id: 'shared-home', name: 'Unused', voxel_data: voxelData })
  mock.placements = [placement(0), placement(90), { ...placement(180), home_id: 'other-home' }]
  const data = await fetchSharedRoom()
  assert.equal(data.instances.length, 2)
  assert.equal(data.instances[0].model, data.instances[1].model)
  const query = mock.queryCalls.find(call => call.table === 'furniture')
  assert.deepEqual(query.inFilters, [['id', ['design']]])
  assert.deepEqual(query.filters, [['home_id', 'shared-home']])
  assert.ok(mock.queryCalls.every(call => call.operation === 'select'))
})
test('missing/corrupt designs warn without crashing; network errors do not masquerade as empty', async () => {
  mock.reset(); signIn()
  mock.placements = [placement(0)]
  assert.ok((await fetchSharedRoom()).warnings.length)
  mock.furniture.set('design', { id: 'design', home_id: 'shared-home', name: 'Broken', voxel_data: {} })
  assert.match((await fetchSharedRoom()).warnings.join(' '), /invalid voxel data/)
  mock.roomError = { message: 'Offline' }; await assert.rejects(fetchSharedRoom, /Unable to load your shared room/)
  mock.roomError = null; mock.furnitureError = { message: 'Offline' }; await assert.rejects(fetchSharedRoom, /Unable to load room furniture designs/)
})
test('room refetch renders updated shared definition rather than an instance copy', async () => {
  mock.reset(); signIn()
  const model = editModel(new Map(), 'add', { x: 5, y: 4, z: 5 }, '#8b5e3c')
  const row = await createFurniture('Chair', model)
  mock.placements = [{ ...placement(0), furniture_id: row.id }]
  assert.equal((await fetchSharedRoom()).instances[0].model.voxels[0].color, '#8b5e3c')
  await updateFurniture(row.id, 'Chair', editModel(model, 'paint', { x: 5, y: 4, z: 5 }, '#ffffff'))
  assert.equal((await fetchSharedRoom()).instances[0].model.voxels[0].color, '#ffffff')
})
test('room route shows home/empty state, refreshes seeded records, and reports load failures', async () => {
  mock.reset(); signIn()
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter initialEntries={['/room']}><AuthProvider><App /></AuthProvider></MemoryRouter>) })
  assert.match(JSON.stringify(renderer.toJSON()), /Our Cubby/)
  assert.match(JSON.stringify(renderer.toJSON()), /The room is empty/)
  mock.furniture.set('design', { id: 'design', home_id: 'shared-home', name: 'Chair', voxel_data: voxelData })
  mock.placements = [placement(270)]
  const refresh = () => renderer.root.findAllByType('button').find((node: any) => node.children.includes('Refresh room'))
  await act(async () => refresh().props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /1.*instances/)
  mock.roomError = { message: 'Offline' }
  await act(async () => refresh().props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /Unable to load your shared room/)
  await act(async () => renderer.unmount())
  assert.equal(mock.listeners.size, 0)
})
