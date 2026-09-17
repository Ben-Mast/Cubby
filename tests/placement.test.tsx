import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { lowestRestingPosition, placementBounds, rotate90, snapFloorPoint, validatePlacement, validateRoomResize, worldVoxels } from '../src/features/room/placement'
import { reconstructRoomModel, type RoomInstance } from '../src/features/room/model'
import { createPlacement, fetchSharedRoom, removePlacement, updatePlacement, updateRoomDimensions } from '../src/features/room/data'
import { RoomWorkspace } from '../src/routes/RoomPage'
import { FurnitureThumbnail } from '../src/features/furniture/FurnitureThumbnail'
import { mock } from './mockSupabase'
import { PerspectiveCamera, Vector3, Scene, Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three'
import { pickRoomItem, pickRoomPosition } from '../src/features/room/input'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { App } from '../src/app/App'
import { identities } from '../src/features/auth/identities'
import { sceneLifecycle } from './mockScene'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const design = { id: 'design', home_id: 'shared-home', creator_id: 'user-one', name: 'Bench', created_at: '', updated_at: '',
  voxel_data: { version: 1 as const, size: [16,16,16] as [number,number,number], voxels: [
    { x: 4, y: 6, z: 9, color: '#8b5e3c' }, { x: 15, y: 8, z: 12, color: '#ffffff' },
  ] } }
const model = reconstructRoomModel(design.voxel_data) // 12 x 3 x 4 occupied voxels
const position = { x: 8, y: 0, z: 16, rotation: 0 as const }
const instance: RoomInstance = { name: 'Bench', model, placement: { id: 'placed', home_id: 'shared-home', furniture_id: 'design', ...position } }
function setup() { mock.reset(); mock.session = { user: { id: 'user-one' } }; mock.furniture.set('design', design) }

test('floor points snap deterministically to integer cells without hiding outside positions', () => {
  assert.deepEqual(snapFloorPoint(-7.01, 7.99), { x: 3, z: 63 })
  assert.deepEqual(snapFloorPoint(-8.01, 8), { x: -1, z: 64 })
  assert.deepEqual(snapFloorPoint(0,0), { x: 32,z: 32 })
  assert.deepEqual(snapFloorPoint(0.24, 0), { x: 32,z: 32 })
  assert.deepEqual(snapFloorPoint(0.25, 0), { x: 33,z: 32 })
  let rotation = position.rotation as 0 | 90 | 180 | 270
  for (const expected of [90,180,270,0]) { rotation = rotate90(rotation); assert.equal(rotation, expected) }
})
test('custom room dimensions affect floor snapping, placement, stacking and safe shrink', () => {
  const dimensions = { width: 8, depth: 10, height: 4 }
  assert.deepEqual(snapFloorPoint(0, 0, dimensions), { x: 4, z: 5 })
  const cube = reconstructRoomModel({ version: 1, size: [3, 2, 4], voxels: [{ x: 2, y: 1, z: 3, color: '#ffffff' }] })
  const at = { x: 7, y: 0, z: 9, rotation: 0 as const }
  const placed = { model: cube, placement: { ...instance.placement, ...at } }
  assert.equal(validatePlacement(cube, at, [], undefined, dimensions), null)
  assert.match(validatePlacement(cube, { ...at, x: 8 }, [], undefined, dimensions)!, /inside/)
  assert.equal(lowestRestingPosition(cube, 7, 9, 0, [], undefined, dimensions)?.y, 0)
  assert.match(validateRoomResize([placed], { ...dimensions, width: 7 })!, /outside/)
  assert.equal(validateRoomResize([placed], { ...dimensions, width: 9 }), null)
})
test('room resize saves through the shared home and rejects occupied voxels outside a shrink', async () => {
  setup()
  mock.furniture.set('tiny', { ...design, id: 'tiny', voxel_data: { version: 1, size: [2, 2, 2],
    voxels: [{ x: 0, y: 0, z: 0, color: '#ffffff' }] } })
  mock.placements = [{ id: 'at-edge', home_id: 'shared-home', furniture_id: 'tiny', x: 63, y: 0, z: 63, rotation: 0 }]
  const grown = await updateRoomDimensions({ width: 80, depth: 70, height: 20 })
  assert.deepEqual([grown.width, grown.depth, grown.height], [80, 70, 20])
  await assert.rejects(updateRoomDimensions({ width: 63, depth: 70, height: 20 }), /outside/)
  assert.equal(mock.home.width, 80)
})
test('actual room rays target floor independent of furniture height and resolve model selection tags', () => {
  const camera = new PerspectiveCamera(45,1,0.1,100)
  camera.position.set(12,16,12); camera.lookAt(0,0,0); camera.updateMatrixWorld()
  const rect = { left: 10,top: 20,width: 500,height: 500 }
  const screen = (world: Vector3) => { const point = world.project(camera); return [10+(point.x+1)*250,20+(1-point.y)*250] as const }
  const [x,y] = screen(new Vector3(-3.8,0,2.4))
  assert.deepEqual(pickRoomPosition(x,y,rect,camera), { x: 16,z: 41 })
  const scene = new Scene(), group = new Group()
  group.userData.placementId = 'selected'
  group.add(new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial()))
  group.position.set(0,1,0); scene.add(group); scene.updateMatrixWorld(true)
  const [sx,sy] = screen(new Vector3(0,1,0))
  assert.equal(pickRoomItem(sx,sy,rect,camera,scene),'selected')
  assert.equal(pickRoomItem(10,20,rect,camera,scene),null)
})
test('bounds derive from occupied voxels, swap after rotation, and allow exact room edges', () => {
  assert.deepEqual(placementBounds(model, position), { x: 8,y: 0,z: 16,maxX: 20,maxY: 3,maxZ: 20 })
  for (const rotation of [0,90,180,270] as const) {
    const sideways = rotation % 180 !== 0
    assert.equal(validatePlacement(model, { x: sideways ? 60 : 52, y: 0, z: sideways ? 52 : 60, rotation }, []), null)
    assert.match(validatePlacement(model, { x: 63,y: 0,z: 63,rotation }, [])!, /inside/)
  }
  assert.match(validatePlacement(model, { ...position,x: -1 }, [])!, /inside/)
  assert.match(validatePlacement(model, { ...position,y: -1 }, [])!, /inside/)
  assert.match(validatePlacement(model, { ...position,y: 14 }, [])!, /inside/)
  assert.match(validatePlacement(model, { ...position,x: 1.5 }, [])!, /integer/)
  assert.match(validatePlacement(model, { ...position,rotation: 45 as any }, [])!, /90/)
})
test('voxel collision permits hollow footprints, rejects occupied cells, and ignores moving self', () => {
  assert.match(validatePlacement(model, position, [instance])!, /overlaps/)
  assert.equal(validatePlacement(model, position, [instance], 'placed'), null)
  assert.equal(validatePlacement(model, { ...position,x: 9 }, [instance]), null, 'bounding boxes intersect but voxels do not')
  assert.deepEqual(worldVoxels(model, { ...position,rotation: 90 }), [
    { x: 8,y: 0,z: 27 }, { x: 11,y: 2,z: 16 },
  ])
  const cube = reconstructRoomModel({ version: 1,size: [16,16,16],voxels: [{ x: 0,y: 0,z: 0,color: '#ffffff' }] })
  const first = { ...instance, model: cube }
  assert.match(validatePlacement(cube, position, [first])!, /overlaps/)
  assert.equal(validatePlacement(cube, { ...position,x: 9 }, [first]), null)
})
test('lowest supported y rises onto a table, drops off it, and rotation recalculates occupancy', () => {
  const table = reconstructRoomModel({ version: 1,size: [16,16,16],voxels: [
    { x: 0,y: 0,z: 0,color: '#ffffff' }, { x: 1,y: 0,z: 0,color: '#ffffff' },
    { x: 0,y: 1,z: 0,color: '#ffffff' }, { x: 1,y: 1,z: 0,color: '#ffffff' },
  ] })
  const item = reconstructRoomModel({ version: 1,size: [16,16,16],voxels: [
    { x: 0,y: 0,z: 0,color: '#ffffff' }, { x: 0,y: 1,z: 0,color: '#ffffff' },
  ] })
  const tableInstance: RoomInstance = { model: table, placement: { ...instance.placement,id: 'table',x: 20,y: 0,z: 20 } }
  const stacked = lowestRestingPosition(item, 20, 20, 0, [tableInstance])!
  assert.deepEqual(stacked, { x: 20,y: 2,z: 20,rotation: 0 })
  assert.equal(validatePlacement(item, stacked, [tableInstance]), null)
  assert.match(validatePlacement(item, { ...stacked,y: 1 }, [tableInstance])!, /overlaps/)
  assert.match(validatePlacement(item, { ...stacked,y: 4 }, [tableInstance])!, /support/)
  assert.deepEqual(lowestRestingPosition(item, 22, 20, 0, [tableInstance]), { x: 22,y: 0,z: 20,rotation: 0 })
  const second: RoomInstance = { model: item, placement: { ...tableInstance.placement,id: 'stacked',furniture_id: 'item',...stacked } }
  assert.equal(lowestRestingPosition(item, 20, 20, 0, [tableInstance, second])?.y, 4)
  assert.equal(lowestRestingPosition(item, 20, 20, 0, [tableInstance, second], 'stacked')?.y, 2)
  const rotated = lowestRestingPosition(table, 20, 20, 90, [second])
  assert.equal(rotated?.y, 0, 'rotation changes the voxel footprint before choosing height')
})
test('create/reload/move/rotate/remove use shared home, preserve instance identity and definition', async () => {
  setup()
  const row = await createPlacement('design', position)
  assert.equal(mock.placements[0].created_by, 'user-one')
  assert.equal((await fetchSharedRoom()).instances[0].placement.id, row.id)
  await updatePlacement(row.id, 'design', { x: 24,y: 0,z: 24,rotation: 90 })
  assert.deepEqual((await fetchSharedRoom()).instances[0].placement, { ...row,x: 24,y: 0,z: 24,rotation: 90 })
  mock.session = { user: { id: 'user-two' } }
  assert.equal((await fetchSharedRoom()).instances[0].placement.id, row.id)
  await updatePlacement(row.id, 'design', { x: 24,y: 0,z: 24,rotation: 180 })
  assert.equal(mock.placements[0].created_by, 'user-one')
  await removePlacement(row.id)
  assert.equal((await fetchSharedRoom()).instances.length, 0)
  assert.ok(mock.furniture.has('design'))
  assert.ok(mock.queryCalls.filter(call => call.operation === 'update' || call.operation === 'delete').every(call => call.filters.some(([column,value]: any) => column === 'home_id' && value === 'shared-home')))
})
test('writes revalidate latest room/geometry, reject invalid or unavailable data, and require authentication', async () => {
  setup()
  await assert.rejects(createPlacement('design', { ...position,x: 63 }), /inside/)
  await createPlacement('design', position)
  await assert.rejects(createPlacement('design', position), /overlaps/)
  assert.equal(mock.placements.length, 1)
  await assert.rejects(updatePlacement('missing', 'design', position), /no longer exists/)
  await assert.rejects(createPlacement('foreign-design', position), /not accessible/)
  mock.furniture.set('design', { ...design,voxel_data: {} })
  await assert.rejects(createPlacement('design', { ...position,x: 30 }), /repair/)
  mock.session = null
  await assert.rejects(createPlacement('design', position), /Sign in/)
  await assert.rejects(removePlacement('placed'), /Sign in/)
})

test('workspace placement, invalid feedback, cancellation, camera isolation, move, rotation and removal', async () => {
  let renderer: any
  let room = { home: { id: 'shared-home',name: 'Home',created_at: '',width: 64,depth: 64,height: 16 },instances: [] as RoomInstance[],furniture: [],warnings: [] }
  let picked: typeof design | null = design
  let calls: any[] = []
  const row = { ...instance.placement }
  const actions = {
    create: async (...args: any[]) => { calls.push(['create',...args]); return row },
    update: async (...args: any[]) => { calls.push(['update',...args]); return row },
    remove: async (...args: any[]) => { calls.push(['remove',...args]) },
  }
  const element = () => <MemoryRouter><RoomWorkspace room={room} design={picked} refresh={() => {}} clearDesign={() => { picked = null }} chooseFurniture={() => {}} actions={actions} /></MemoryRouter>
  const render = async () => act(async () => { if (renderer) renderer.update(element()); else renderer = create(element()) })
  const button = (name: string) => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === name)
  const scene = () => renderer.root.findAllByType('div').find((node: any) => node.props['data-scene-props'])!.props['data-scene-props']
  await render()
  await act(async () => { scene().onDragStart(null, { x: 63,z: 63 }); scene().onDragEnd({ x: 63,z: 63 }) })
  assert.equal(button('Confirm placement').props.disabled, true)
  assert.match(JSON.stringify(renderer.toJSON()), /inside the room/)
  await act(async () => { scene().onDragStart(null, { x: 20,z: 28 }); scene().onDragEnd({ x: 20,z: 28 }) })
  await act(async () => button('Rotate preview 90 degrees').props.onClick())
  assert.equal(scene().preview.placement.rotation, 90)
  await act(async () => button('Confirm placement').props.onClick())
  assert.deepEqual(calls[0], ['create','design',{ x: 20,y: 0,z: 28,rotation: 90 }])
  room = { ...room,instances: [instance] }; await render()
  await act(async () => scene().onSelect('placed'))
  assert.equal(scene().selectedId, 'placed')
  await act(async () => { scene().onDragStart('placed', { x: 8,z: 16 }); scene().onDrag({ x: 24,z: 24 }); scene().onDragEnd({ x: 24,z: 24 }) })
  assert.deepEqual(calls[1], ['update','placed','design',{ x: 24,y: 0,z: 24,rotation: 0 }])
  await act(async () => button('Rotate selected furniture 90 degrees').props.onClick())
  assert.equal(calls[2][3].rotation, 90)
  await act(async () => button('Remove selected furniture').props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /saved design stays/)
  await act(async () => button('Cancel removal').props.onClick())
  assert.equal(calls.length, 3)
  await act(async () => button('Remove selected furniture').props.onClick())
  await act(async () => button('Confirm removal').props.onClick())
  assert.deepEqual(calls[3], ['remove','placed'])
  await act(async () => renderer.unmount())
})
test('drag preview rises onto support, drops back to floor, and writes only at release', async () => {
  const tableModel = reconstructRoomModel({ version: 1,size: [16,16,16],voxels: [
    { x: 0,y: 0,z: 0,color: '#ffffff' }, { x: 0,y: 1,z: 0,color: '#ffffff' },
  ] })
  const itemModel = reconstructRoomModel({ version: 1,size: [16,16,16],voxels: [
    { x: 0,y: 0,z: 0,color: '#ffffff' }, { x: 0,y: 1,z: 0,color: '#ffffff' },
  ] })
  const table: RoomInstance = { model: tableModel, placement: { ...instance.placement,id: 'table',x: 20,y: 0,z: 20 } }
  const item: RoomInstance = { model: itemModel, placement: { ...instance.placement,id: 'item',x: 24,y: 0,z: 20 } }
  const calls: any[] = []
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter><RoomWorkspace
    room={{ home: { id: 'shared-home',name: 'Home',created_at: '',width: 64,depth: 64,height: 16 },instances: [table,item],furniture: [],warnings: [] }}
    design={null} refresh={() => {}} clearDesign={() => {}} chooseFurniture={() => {}}
    actions={{ create: createPlacement,remove: removePlacement,
      update: async (...args: any[]) => { calls.push(args); return { ...item.placement,...args[2] } } } as any} /></MemoryRouter>) })
  const scene = () => renderer.root.findAllByType('div').find((node: any) => node.props['data-scene-props'])!.props['data-scene-props']
  await act(async () => scene().onSelect('item'))
  await act(async () => { scene().onDragStart('item', { x: 24,z: 20 }); scene().onDrag({ x: 20,z: 20 }) })
  assert.equal(scene().instances.find((entry: RoomInstance) => entry.placement.id === 'item').placement.y, 2)
  assert.equal(calls.length, 0)
  await act(async () => scene().onDrag({ x: 24,z: 20 }))
  assert.equal(scene().instances.find((entry: RoomInstance) => entry.placement.id === 'item').placement.y, 0)
  await act(async () => scene().onDrag({ x: 20,z: 20 }))
  await act(async () => scene().onDragEnd({ x: 20,z: 20 }))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][2], { x: 20,y: 2,z: 20,rotation: 0 })
  await act(async () => renderer.unmount())
})
test('slow placement saves keep preview or same-ID furniture visible without a scene remount or refetch', async () => {
  let renderer: any, refreshes = 0, writes = 0
  let remoteUpsert: (item: RoomInstance) => void = () => {}
  let finishCreate: (row: typeof instance.placement) => void = () => {}
  let finishUpdate: (row: typeof instance.placement) => void = () => {}
  let finishRemove: () => void = () => {}
  const actions = {
    create: () => { writes++; return new Promise<typeof instance.placement>(resolve => { finishCreate = resolve }) },
    update: () => { writes++; return new Promise<typeof instance.placement>(resolve => { finishUpdate = resolve }) },
    remove: () => { writes++; return new Promise<void>(resolve => { finishRemove = resolve }) },
  }
  function Harness() {
    const [room, setRoom] = useState({ home: { id: 'shared-home', name: 'Home', created_at: '',width: 64,depth: 64,height: 16 },
      instances: [] as RoomInstance[], furniture: [], warnings: [] })
    const [picked, setPicked] = useState<typeof design | null>(design)
    remoteUpsert = item => setRoom(current => ({ ...current, instances: [...current.instances.filter(existing =>
      existing.placement.id !== item.placement.id), item] }))
    return <MemoryRouter><RoomWorkspace room={room} design={picked} refresh={() => { refreshes++ }}
      upsertPlacement={remoteUpsert}
      removePlacement={id => setRoom(current => ({ ...current, instances: current.instances.filter(item => item.placement.id !== id) }))}
      clearDesign={() => setPicked(null)} chooseFurniture={() => {}} actions={actions} /></MemoryRouter>
  }
  const mounts = sceneLifecycle.mounts, unmounts = sceneLifecycle.unmounts
  await act(async () => { renderer = create(<Harness />) })
  const scene = () => renderer.root.findAllByType('div').find((node: any) => node.props['data-scene-props'])!.props['data-scene-props']
  const button = (name: string) => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === name)
  await act(async () => { scene().onDragStart(null, { x: 5, z: 5 }); scene().onDragEnd({ x: 5, z: 5 }) })
  await act(async () => button('Confirm placement').props.onClick())
  assert.equal(writes, 1)
  assert.equal(scene().instances.length, 0)
  assert.ok(scene().preview, 'preview remains while create is pending')
  assert.equal(refreshes, 0)
  await act(async () => remoteUpsert({ ...instance, placement: { ...instance.placement, x: 5, z: 5 } }))
  assert.equal(scene().instances.length, 0, 'early realtime echo stays under the preview')
  await act(async () => finishCreate({ ...instance.placement, x: 5, z: 5 }))
  assert.equal(scene().instances.length, 1)
  assert.equal(scene().instances[0].placement.id, 'placed')
  assert.equal(scene().preview, null)
  await act(async () => scene().onSelect('placed'))
  await act(async () => { scene().onDragStart('placed', { x: 5, z: 5 }); scene().onDrag({ x: 8, z: 8 }) })
  assert.equal(writes, 1, 'pointer movement does not write to the database')
  assert.equal(scene().instances[0].placement.x, 8)
  await act(async () => scene().onDragEnd({ x: 8, z: 8 }))
  assert.equal(writes, 2)
  assert.equal(scene().instances[0].placement.id, 'placed')
  assert.equal(scene().instances[0].placement.x, 8, 'new position stays visible during save')
  assert.equal(scene().preview, null)
  await act(async () => finishUpdate({ ...instance.placement, x: 8, z: 8 }))
  assert.equal(scene().instances[0].placement.x, 8)
  await act(async () => button('Rotate selected furniture 90 degrees').props.onClick())
  assert.equal(scene().instances[0].placement.rotation, 90)
  await act(async () => finishUpdate({ ...instance.placement, x: 8, z: 8, rotation: 90 }))
  assert.equal(scene().instances[0].placement.rotation, 90)
  await act(async () => remoteUpsert({ ...instance, placement: { ...instance.placement, id: 'other', x: 12, z: 12 } }))
  assert.equal(scene().instances.length, 2)
  await act(async () => button('Remove selected furniture').props.onClick())
  await act(async () => button('Confirm removal').props.onClick())
  assert.equal(scene().instances.length, 1)
  assert.equal(scene().instances[0].placement.id, 'other')
  await act(async () => finishRemove())
  assert.equal(scene().instances.length, 1)
  assert.equal(scene().instances[0].placement.id, 'other')
  assert.equal(refreshes, 0)
  assert.equal(sceneLifecycle.mounts, mounts + 1)
  assert.equal(sceneLifecycle.unmounts, unmounts)
  await act(async () => renderer.unmount())
})
test('library Place in Room links to protected room placement mode and saves through the real loader', async () => {
  setup(); mock.session.user.email = identities[0].email
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter initialEntries={['/furniture']}><AuthProvider><App /></AuthProvider></MemoryRouter>) })
  const link = renderer.root.findAllByType('a').find((node: any) => node.props['aria-label'] === 'Place Bench in room')
  assert.equal(link.props.href, '/room?place=design')
  await act(async () => renderer.unmount())
  await act(async () => { renderer = create(<MemoryRouter initialEntries={['/room?place=design']}><AuthProvider><App /></AuthProvider></MemoryRouter>) })
  const scene = () => renderer.root.findAllByType('div').find((node: any) => node.props['data-scene-props'])!.props['data-scene-props']
  await act(async () => { scene().onDragStart(null, { x: 4,z: 6 }); scene().onDragEnd({ x: 4,z: 6 }) })
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Confirm placement' }).props.onClick())
  assert.equal(mock.placements.length,1)
  assert.equal(mock.placements[0].x,4)
  assert.match(JSON.stringify(renderer.toJSON()), /1.*instances/)
  await act(async () => renderer.unmount())
})

test('room picker reuses saved thumbnails, falls back when missing, and selects on tap', async () => {
  setup()
  const path = 'shared-home/design/saved.webp'
  mock.storageFiles.set(path, new Blob(['image'], { type: 'image/webp' }))
  const room = { home: { id: 'shared-home', name: 'Home', created_at: '', width: 64, depth: 64, height: 16 },
    instances: [] as RoomInstance[], warnings: [], furniture: [
      { id: 'design', home_id: 'shared-home', creator_id: 'user-one', name: 'Bench', thumbnail_path: path,
        created_at: '', updated_at: '', creator: { display_name: 'Ben' } },
      { id: 'missing', home_id: 'shared-home', creator_id: 'user-one', name: 'No image', thumbnail_path: null,
        created_at: '', updated_at: '', creator: { display_name: 'Ben' } },
    ] }
  let renderer: any
  function Harness() {
    const [picked, setPicked] = useState<typeof design | null>(null)
    return <MemoryRouter><RoomWorkspace room={room} design={picked} refresh={() => {}}
      clearDesign={() => setPicked(null)} chooseFurniture={id => { if (id === 'design') setPicked(design) }} /></MemoryRouter>
  }
  await act(async () => { renderer = create(<Harness />) })
  const button = (name: string) => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === name)
  await act(async () => button('Open furniture picker').props.onClick())
  const previews = renderer.root.findAllByType(FurnitureThumbnail)
  assert.equal(previews.length, 2)
  assert.equal(previews[0].props.path, path)
  assert.equal(previews[1].props.path, null)
  assert.equal(renderer.root.findAllByType('img').length, 1)
  assert.match(renderer.root.findByType('img').props.src, /shared-home\/design\/saved.webp$/)
  assert.equal(mock.storageCalls.filter(call => call.operation === 'upload').length, 0)
  assert.ok(button('Place No image').findAllByType('svg').length > 0, 'missing thumbnail shows fallback icon')
  await act(async () => button('Place Bench').props.onClick())
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Choose furniture' }).length, 0)
  const scene = renderer.root.findAllByType('div').find((node: any) => node.props['data-scene-props'])!.props['data-scene-props']
  assert.equal(scene.preview.placement.furniture_id, 'design')
  await act(async () => renderer.unmount())
})

test('placement failures retain the draft, refetch authoritative state, and block double submissions', async () => {
  let renderer: any, rejectSave: (reason: Error) => void = () => {}
  let submissions = 0, refreshes = 0
  const actions = {
    create: async () => { submissions++; return new Promise<any>((_resolve,reject) => { rejectSave = reject }) },
    update: updatePlacement,remove: removePlacement,
  }
  await act(async () => { renderer = create(<MemoryRouter><RoomWorkspace
    room={{ home: { id: 'shared-home',name: 'Home',created_at: '',width: 64,depth: 64,height: 16 },instances: [],furniture: [],warnings: [] }}
    design={design} refresh={() => { refreshes++ }} clearDesign={() => {}} chooseFurniture={() => {}} actions={actions} /></MemoryRouter>) })
  const button = (name: string) => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === name)
  await act(async () => { button('Confirm placement').props.onClick(); button('Confirm placement').props.onClick() })
  assert.equal(submissions,1)
  await act(async () => rejectSave(new Error('Offline; refresh before retrying.')))
  assert.equal(refreshes,1)
  assert.match(JSON.stringify(renderer.toJSON()), /Offline; refresh before retrying/)
  assert.ok(button('Confirm placement'))
  await act(async () => button('Cancel placement').props.onClick())
  assert.equal(submissions,1)
  await act(async () => renderer.unmount())
})
