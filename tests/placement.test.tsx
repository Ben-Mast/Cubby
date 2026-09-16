import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { placementBounds, rotate90, snapFloorPoint, validatePlacement } from '../src/features/room/placement'
import { reconstructRoomModel, type RoomInstance } from '../src/features/room/model'
import { createPlacement, fetchSharedRoom, removePlacement, updatePlacement } from '../src/features/room/data'
import { RoomWorkspace } from '../src/routes/RoomPage'
import { mock } from './mockSupabase'
import { PerspectiveCamera, Vector3, Scene, Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three'
import { pickRoomItem, pickRoomPosition } from '../src/features/room/input'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { App } from '../src/app/App'
import { identities } from '../src/features/auth/identities'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const design = { id: 'design', home_id: 'shared-home', creator_id: 'user-one', name: 'Bench', created_at: '', updated_at: '',
  voxel_data: { version: 1 as const, size: [16,16,16] as [number,number,number], voxels: [
    { x: 4, y: 6, z: 9, color: '#8b5e3c' }, { x: 15, y: 8, z: 12, color: '#ffffff' },
  ] } }
const model = reconstructRoomModel(design.voxel_data) // 3 x 1 world-unit occupied bounds
const position = { x: 2, z: 4, rotation: 0 as const }
const instance: RoomInstance = { name: 'Bench', model, placement: { id: 'placed', home_id: 'shared-home', furniture_id: 'design', ...position } }
function setup() { mock.reset(); mock.session = { user: { id: 'user-one' } }; mock.furniture.set('design', design) }

test('floor points snap deterministically to integer cells without hiding outside positions', () => {
  assert.deepEqual(snapFloorPoint(-7.01, 7.99), { x: 0, z: 15 })
  assert.deepEqual(snapFloorPoint(-8.01, 8), { x: -1, z: 16 })
  assert.deepEqual(snapFloorPoint(0,0), { x: 8,z: 8 })
  let rotation = position.rotation as 0 | 90 | 180 | 270
  for (const expected of [90,180,270,0]) { rotation = rotate90(rotation); assert.equal(rotation, expected) }
})
test('actual room rays target floor independent of furniture height and resolve model selection tags', () => {
  const camera = new PerspectiveCamera(45,1,0.1,100)
  camera.position.set(12,16,12); camera.lookAt(0,0,0); camera.updateMatrixWorld()
  const rect = { left: 10,top: 20,width: 500,height: 500 }
  const screen = (world: Vector3) => { const point = world.project(camera); return [10+(point.x+1)*250,20+(1-point.y)*250] as const }
  const [x,y] = screen(new Vector3(-3.8,0,2.4))
  assert.deepEqual(pickRoomPosition(x,y,rect,camera), { x: 4,z: 10 })
  const scene = new Scene(), group = new Group()
  group.userData.placementId = 'selected'
  group.add(new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial()))
  group.position.set(0,1,0); scene.add(group); scene.updateMatrixWorld(true)
  const [sx,sy] = screen(new Vector3(0,1,0))
  assert.equal(pickRoomItem(sx,sy,rect,camera,scene),'selected')
  assert.equal(pickRoomItem(10,20,rect,camera,scene),null)
})
test('bounds derive from occupied voxels, swap after rotation, and allow exact room edges', () => {
  assert.deepEqual(placementBounds(model, position), { x: 2,z: 4,maxX: 5,maxZ: 5 })
  for (const rotation of [0,90,180,270] as const) {
    const sideways = rotation % 180 !== 0
    assert.equal(validatePlacement(model, { x: sideways ? 15 : 13, z: sideways ? 13 : 15, rotation }, []), null)
    assert.match(validatePlacement(model, { x: 15,z: 15,rotation }, [])!, /inside/)
  }
  assert.match(validatePlacement(model, { ...position,x: -1 }, [])!, /inside/)
  assert.match(validatePlacement(model, { ...position,x: 1.5 }, [])!, /integer/)
  assert.match(validatePlacement(model, { ...position,rotation: 45 as any }, [])!, /90/)
})
test('AABB collision rejects intersections after rotation, permits edge contact, and ignores moving self', () => {
  assert.match(validatePlacement(model, position, [instance])!, /overlaps/)
  assert.equal(validatePlacement(model, position, [instance], 'placed'), null)
  assert.equal(validatePlacement(model, { ...position,x: 5 }, [instance]), null)
  assert.equal(validatePlacement(model, { ...position,x: 1,z: 5 }, [instance]), null)
  assert.equal(validatePlacement(model, { x: 2,z: 3,rotation: 0 }, [instance]), null)
  assert.match(validatePlacement(model, { x: 2,z: 3,rotation: 90 }, [instance])!, /overlaps/)
  const rotated = { ...instance, placement: { ...instance.placement,rotation: 90 as const } }
  assert.match(validatePlacement(model, { x: 2,z: 6,rotation: 0 }, [rotated])!, /overlaps/)
})
test('create/reload/move/rotate/remove use shared home, preserve instance identity and definition', async () => {
  setup()
  const row = await createPlacement('design', position)
  assert.equal(mock.placements[0].created_by, 'user-one')
  assert.equal((await fetchSharedRoom()).instances[0].placement.id, row.id)
  await updatePlacement(row.id, 'design', { x: 8,z: 8,rotation: 90 })
  assert.deepEqual((await fetchSharedRoom()).instances[0].placement, { ...row,x: 8,z: 8,rotation: 90 })
  mock.session = { user: { id: 'user-two' } }
  assert.equal((await fetchSharedRoom()).instances[0].placement.id, row.id)
  await updatePlacement(row.id, 'design', { x: 8,z: 8,rotation: 180 })
  assert.equal(mock.placements[0].created_by, 'user-one')
  await removePlacement(row.id)
  assert.equal((await fetchSharedRoom()).instances.length, 0)
  assert.ok(mock.furniture.has('design'))
  assert.ok(mock.queryCalls.filter(call => call.operation === 'update' || call.operation === 'delete').every(call => call.filters.some(([column,value]: any) => column === 'home_id' && value === 'shared-home')))
})
test('writes revalidate latest room/geometry, reject invalid or unavailable data, and require authentication', async () => {
  setup()
  await assert.rejects(createPlacement('design', { ...position,x: 15 }), /inside/)
  await createPlacement('design', position)
  await assert.rejects(createPlacement('design', position), /overlaps/)
  assert.equal(mock.placements.length, 1)
  await assert.rejects(updatePlacement('missing', 'design', position), /no longer exists/)
  await assert.rejects(createPlacement('foreign-design', position), /not accessible/)
  mock.furniture.set('design', { ...design,voxel_data: {} })
  await assert.rejects(createPlacement('design', { ...position,x: 8 }), /repair/)
  mock.session = null
  await assert.rejects(createPlacement('design', position), /Sign in/)
  await assert.rejects(removePlacement('placed'), /Sign in/)
})

test('workspace placement, invalid feedback, cancellation, camera isolation, move, rotation and removal', async () => {
  let renderer: any
  let room = { home: { id: 'shared-home',name: 'Home',created_at: '' },instances: [] as RoomInstance[],furniture: [],warnings: [] }
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
  await act(async () => { scene().onDragStart(null, { x: 15,z: 15 }); scene().onDragEnd({ x: 15,z: 15 }) })
  assert.equal(button('Confirm placement').props.disabled, true)
  assert.match(JSON.stringify(renderer.toJSON()), /inside the room/)
  await act(async () => { scene().onDragStart(null, { x: 5,z: 7 }); scene().onDragEnd({ x: 5,z: 7 }) })
  await act(async () => button('Rotate preview 90 degrees').props.onClick())
  assert.equal(scene().preview.placement.rotation, 90)
  await act(async () => button('Confirm placement').props.onClick())
  assert.deepEqual(calls[0], ['create','design',{ x: 5,z: 7,rotation: 90 }])
  room = { ...room,instances: [instance] }; await render()
  await act(async () => scene().onSelect('placed'))
  assert.equal(scene().selectedId, 'placed')
  await act(async () => { scene().onDragStart('placed', { x: 2,z: 4 }); scene().onDrag({ x: 8,z: 8 }); scene().onDragEnd({ x: 8,z: 8 }) })
  assert.deepEqual(calls[1], ['update','placed','design',{ x: 8,z: 8,rotation: 0 }])
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

test('placement failures retain the draft, refetch authoritative state, and block double submissions', async () => {
  let renderer: any, rejectSave: (reason: Error) => void = () => {}
  let submissions = 0, refreshes = 0
  const actions = {
    create: async () => { submissions++; return new Promise<any>((_resolve,reject) => { rejectSave = reject }) },
    update: updatePlacement,remove: removePlacement,
  }
  await act(async () => { renderer = create(<MemoryRouter><RoomWorkspace
    room={{ home: { id: 'shared-home',name: 'Home',created_at: '' },instances: [],furniture: [],warnings: [] }}
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
