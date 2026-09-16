import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/app/App'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { identities } from '../src/features/auth/identities'
import { fetchSharedRoom } from '../src/features/room/data'
import { reconstructRoomModel, roomTransform, type PlacedFurniture, type RoomRotation } from '../src/features/room/model'
import { DEFAULT_ROOM_DIMENSIONS, VOXEL_UNIT } from '../src/features/room/config'
import { bindRoomPointerInput, pickRoomItem } from '../src/features/room/input'
import { hiddenWallsForCamera, roomWallBoxes, skipWallRaycast, WALL_THICKNESS } from '../src/features/room/walls'
import { createFurniture, updateFurniture } from '../src/features/furniture/data'
import { editModel, type VoxelData } from '../src/features/voxel/model'
import { mock } from './mockSupabase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const voxelData: VoxelData = { version: 1, size: [16,16,16], voxels: [
  { x: 4, y: 6, z: 9, color: '#8b5e3c' }, { x: 7, y: 8, z: 10, color: '#ffffff' },
] }
const placement = (rotation: RoomRotation): PlacedFurniture => ({ id: `instance-${rotation}`, home_id: 'shared-home', furniture_id: 'design', x: 12, y: 0, z: 20, rotation })
function signIn() { mock.session = { user: { id: 'user-one', email: identities[0].email } } }

test('all camera quadrants show the two far walls and switch with center-axis hysteresis', () => {
  assert.deepEqual(hiddenWallsForCamera(10, 10), { x: 'right', z: 'front' })
  assert.deepEqual(hiddenWallsForCamera(-10, 10), { x: 'left', z: 'front' })
  assert.deepEqual(hiddenWallsForCamera(-10, -10), { x: 'left', z: 'back' })
  assert.deepEqual(hiddenWallsForCamera(10, -10), { x: 'right', z: 'back' })
  assert.deepEqual(hiddenWallsForCamera(-0.1, 10, { x: 'right', z: 'front' }), { x: 'right', z: 'front' })
  assert.deepEqual(hiddenWallsForCamera(-0.4, 10, { x: 'right', z: 'front' }), { x: 'left', z: 'front' })
  assert.deepEqual(hiddenWallsForCamera(10, -0.1, { x: 'right', z: 'front' }), { x: 'right', z: 'front' })
  assert.deepEqual(hiddenWallsForCamera(10, -0.4, { x: 'right', z: 'front' }), { x: 'right', z: 'back' })
})

test('four solid wall boxes use configurable width, depth and height', () => {
  const boxes = roomWallBoxes({ width: 80, depth: 44, height: 20 })
  assert.deepEqual(boxes.front.size, [20, 5, WALL_THICKNESS])
  assert.deepEqual(boxes.back.size, boxes.front.size)
  assert.deepEqual(boxes.left.size, [WALL_THICKNESS, 5, 11])
  assert.deepEqual(boxes.right.size, boxes.left.size)
  assert.deepEqual(boxes.front.position, [0, 2.5, 5.5 + WALL_THICKNESS / 2])
  assert.deepEqual(boxes.back.position, [0, 2.5, -5.5 - WALL_THICKNESS / 2])
  assert.deepEqual(boxes.left.position, [-10 - WALL_THICKNESS / 2, 2.5, 0])
  assert.deepEqual(boxes.right.position, [10 + WALL_THICKNESS / 2, 2.5, 0])
})

test('room walls are excluded from selection rays even while visible or fading', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 3, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
  const scene = new Scene()
  const wall = new Mesh(new BoxGeometry(4, 4, WALL_THICKNESS), new MeshBasicMaterial())
  wall.position.set(0, 1, 2); wall.raycast = skipWallRaycast
  const item = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
  item.userData.placementId = 'furniture'
  item.position.set(0, 0.5, 0)
  scene.add(wall, item); scene.updateMatrixWorld(true)
  const ray = new Raycaster(camera.position, new Vector3(0, 0, 0).sub(camera.position).normalize())
  assert.equal(ray.intersectObject(wall).length, 0)
  assert.equal(pickRoomItem(100, 100, { left: 0, top: 0, width: 200, height: 200 }, camera, scene), 'furniture')
})

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
    near(Math.min(...corners.map(point => point.x)), at.x * VOXEL_UNIT - DEFAULT_ROOM_DIMENSIONS.width * VOXEL_UNIT / 2)
    near(Math.min(...corners.map(point => point.z)), at.z * VOXEL_UNIT - DEFAULT_ROOM_DIMENSIONS.depth * VOXEL_UNIT / 2)
    near(Math.min(...corners.map(point => point.y)), 0)
    near(Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x)), (rotation % 180 === 0 ? 4 : 2) * VOXEL_UNIT)
    near(Math.max(...corners.map(point => point.z)) - Math.min(...corners.map(point => point.z)), (rotation % 180 === 0 ? 2 : 4) * VOXEL_UNIT)
  }
  const raised = roomTransform({ ...placement(90), y: 2 }, model)
  assert.ok(Math.abs(raised.position[1] + model.minY * VOXEL_UNIT - 2 * VOXEL_UNIT) < 1e-9)
  assert.throws(() => reconstructRoomModel({ version: 1, size: [16,16,16], voxels: [] }))
  assert.throws(() => roomTransform({ ...placement(0), rotation: 45 as RoomRotation }, model))
})
test('empty room resolves home and loads the in-room furniture picker; anonymous reads fail', async () => {
  mock.reset(); signIn()
  const data = await fetchSharedRoom()
  assert.equal(data.home.id, 'shared-home'); assert.deepEqual(data.instances, []); assert.deepEqual(data.warnings, [])
  assert.equal(mock.queryCalls.some(call => call.table === 'furniture'), true)
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
  const query = mock.queryCalls.find(call => call.table === 'furniture' && call.inFilters.length)
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
  mock.roomError = null; mock.furnitureError = { message: 'Offline' }; await assert.rejects(fetchSharedRoom, /Unable to load (room furniture designs|furniture)/)
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
test('room route omits the redundant home name, shows empty state, refreshes seeded records, and reports load failures', async () => {
  mock.reset(); signIn()
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter initialEntries={['/room']}><AuthProvider><App /></AuthProvider></MemoryRouter>) })
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Our Cubby/)
  assert.match(JSON.stringify(renderer.toJSON()), /The room is empty/)
  mock.furniture.set('design', { id: 'design', home_id: 'shared-home', name: 'Chair', voxel_data: voxelData })
  mock.placements = [placement(270)]
  const refresh = () => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === 'Refresh room')
  await act(async () => refresh().props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /1.*instances/)
  mock.roomError = { message: 'Offline' }
  await act(async () => refresh().props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /Unable to load your shared room/)
  await act(async () => renderer.unmount())
  assert.equal(mock.listeners.size, 0)
})

test('room pointer gestures orbit by default, tap-select, drag only selected furniture, and deselect on empty tap', () => {
  class TestCanvas extends EventTarget { setPointerCapture(_id: number) {} }
  for (const pointerType of ['mouse', 'touch']) {
    const canvas = new TestCanvas()
    const events: string[] = []
    let selectedId = ''
    let placing = false
    let cameraDrag = true
    let itemPicks = 0
    const unbind = bindRoomPointerInput(canvas as unknown as HTMLCanvasElement, {
      pick: (x) => { itemPicks++; return { id: x < 50 ? 'chair' : null, position: { x: Math.floor(x / 10), z: 3 }, selectedId, placing } },
      position: x => ({ x: Math.floor(x / 10), z: 3 }),
      setCameraDrag: enabled => { cameraDrag = enabled },
      select: id => { selectedId = id; events.push(`select:${id}`) },
      startDrag: id => { events.push(`start:${id}`); return true },
      drag: position => events.push(`drag:${position.x}`),
      endDrag: position => events.push(`end:${position?.x}`),
      cancelDrag: () => events.push('cancel'),
    })
    const send = (type: string, x: number, pointerId = 1) => canvas.dispatchEvent(Object.assign(new Event(type), {
      pointerId, clientX: x, clientY: 20, button: 0, pointerType,
    }))
    send('pointerdown', 20); send('pointermove', 35); send('pointerup', 35)
    assert.equal(cameraDrag, true)
    assert.deepEqual(events, [], 'dragging an unselected item orbits without selecting it')
    send('pointerdown', 20); send('pointerup', 20)
    assert.equal(selectedId, 'chair')
    send('pointerdown', 20); assert.equal(cameraDrag, false)
    send('pointermove', 23); send('pointerup', 23)
    assert.equal(events.some(value => value.startsWith('start:')), false, 'tap jitter does not move furniture')
    const beforeDragPicks = itemPicks
    send('pointerdown', 20); send('pointermove', 32); send('pointerup', 32)
    assert.equal(itemPicks, beforeDragPicks + 1, 'moving only raycasts the floor, not every furniture mesh')
    assert.ok(events.includes('start:chair'))
    assert.ok(events.includes('drag:3'))
    assert.ok(events.includes('end:3'))
    assert.equal(cameraDrag, true)
    send('pointerdown', 70); send('pointerup', 70)
    assert.equal(selectedId, '')
    const count = events.length
    send('pointerdown', 70); send('pointermove', 90); send('pointerup', 90)
    assert.equal(events.length, count, 'empty drag orbits without deselect side effects')
    placing = true
    send('pointerdown', 70); assert.equal(cameraDrag, false)
    send('pointermove', 80); send('pointerup', 80)
    assert.ok(events.includes('start:null'))
    assert.ok(events.includes('end:8'))
    placing = false
    selectedId = 'chair'
    send('pointerdown', 20); send('pointermove', 32)
    if (pointerType === 'touch') {
      send('pointerdown', 30, 2)
      assert.equal(cameraDrag, true)
      assert.equal(events.at(-1), 'cancel')
      send('pointerup', 30, 2)
    } else send('pointercancel', 32)
    send('pointerup', 32)
    const finalCount = events.length
    unbind(); send('pointerdown', 20); send('pointerup', 20)
    assert.equal(events.length, finalCount)
  }
})
