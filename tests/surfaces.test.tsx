import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { App } from '../src/app/App'
import { identities } from '../src/features/auth/identities'
import { createSurface, updateSurface, deleteSurface, applySurface, listSurfacesForHome } from '../src/features/surfaces/data'
import { cellsOnLine, initialPixelHistory, pixelReducer, resizePixels, validatePixels } from '../src/features/surfaces/model'
import { surfaceTextureRepeat } from '../src/features/surfaces/texture'
import { useSurfaceLibrary } from '../src/features/surfaces/useSurfaceLibrary'
import { useSharedRoom } from '../src/features/room/useSharedRoom'
import { LocalSurfaceEditor } from '../src/routes/SurfaceEditorPage'
import { SharedRoomScene } from './mockScene'
import { mock } from './mockSupabase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const signIn = (index = 0) => { mock.session = { user: { id: index ? 'user-two' : 'user-one', email: identities[index].email } } }
const pixels = ['#ffffff', '#34323c', '#34323c', '#ffffff']
const button = (renderer: any, label: string) => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === label)
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('pixel strokes, undo/redo, clear, resizing, validation, and tiling are deterministic', () => {
  assert.deepEqual(cellsOnLine(0, 3, 4), [0, 1, 2, 3])
  assert.deepEqual(cellsOnLine(0, 15, 4), [0, 5, 10, 15])
  let state = initialPixelHistory(Array(16).fill('#ffffff'))
  state = pixelReducer(state, { type: 'start' })
  for (const index of cellsOnLine(0, 3, 4)) state = pixelReducer(state, { type: 'paint', index, color: '#34323c' })
  state = pixelReducer(state, { type: 'end' })
  assert.equal(state.past.length, 1)
  assert.equal(state.present.filter(color => color === '#34323c').length, 4)
  state = pixelReducer(state, { type: 'undo' })
  assert.equal(state.present.filter(color => color === '#34323c').length, 0)
  state = pixelReducer(state, { type: 'redo' })
  assert.equal(state.present.filter(color => color === '#34323c').length, 4)
  state = pixelReducer(state, { type: 'clear' })
  state = pixelReducer(state, { type: 'undo' })
  assert.equal(state.present.filter(color => color === '#34323c').length, 4)
  assert.deepEqual(resizePixels(pixels, 2, 2, 3, 2), ['#ffffff', '#34323c', '#ffffff', '#34323c', '#ffffff', '#ffffff'])
  assert.deepEqual(validatePixels(2, 2, pixels).pixels, pixels)
  assert.throws(() => validatePixels(2, 2, pixels.slice(1)))
  assert.deepEqual(surfaceTextureRepeat({ width: 4, height: 2 }, 32, 12), [8, 6])
  assert.deepEqual(surfaceTextureRepeat({ width: 4, height: 2 }, 64, 24), [16, 12])
})

test('shared surface CRUD/apply uses the home, creator, and safe type', async () => {
  mock.reset(); signIn()
  const floor = await createSurface(' Tiles ', 'floor', 2, 2, pixels)
  assert.equal(floor.name, 'Tiles'); assert.equal(floor.home_id, 'shared-home'); assert.equal(floor.creator_id, 'user-one')
  signIn(1)
  assert.equal((await listSurfacesForHome('shared-home'))[0].creator?.display_name, 'Ben')
  const updated = await updateSurface(floor.id, 'New tiles', 'floor', 2, 2, pixels)
  assert.equal(updated.id, floor.id); assert.equal(updated.updated_at, '2026-09-15T01:00:00Z')
  await applySurface(floor.id, 'floor')
  assert.equal(mock.home.floor_surface_id, floor.id)
  await assert.rejects(() => applySurface(floor.id, 'wall'), /Choose a wall surface/)
  const wall = await createSurface('Stripes', 'wall', 2, 2, pixels)
  await applySurface(wall.id, 'wall')
  assert.equal(mock.home.wall_surface_id, wall.id)
  await deleteSurface(floor.id)
  assert.equal(mock.home.floor_surface_id, null)
  assert.equal(mock.home.wall_surface_id, wall.id)
  await applySurface(null, 'wall')
  assert.equal(mock.home.wall_surface_id, null)
  assert.equal(mock.surfaces.size, 1)
  assert.ok(mock.queryCalls.filter(call => call.table === 'surfaces' && call.operation !== 'insert')
    .every(call => call.filters.some(([column, value]) => column === 'home_id' && value === 'shared-home')))
})

test('2D editor paints across skipped pointer cells and saves one named pattern', async () => {
  let saved: any = null
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter><LocalSurfaceEditor onSave={async (...args) => { saved = args }} /></MemoryRouter>) })
  const name = renderer.root.findByProps({ 'aria-label': 'Surface name' })
  await act(async () => name.props.onChange({ target: { value: 'Checker' } }))
  const canvas = renderer.root.findByType('canvas')
  const target = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 160, height: 160 }),
    setPointerCapture: () => {}, hasPointerCapture: () => false, releasePointerCapture: () => {} }
  await act(async () => {
    canvas.props.onPointerDown({ currentTarget: target, pointerId: 1, button: 0, clientX: 10, clientY: 10 })
    canvas.props.onPointerMove({ currentTarget: target, pointerId: 1, clientX: 70, clientY: 10 })
    canvas.props.onPointerUp({ currentTarget: target, pointerId: 1 })
  })
  assert.equal(button(renderer, 'Undo surface paint').props.disabled, false)
  await act(async () => button(renderer, 'Undo surface paint').props.onClick())
  assert.equal(button(renderer, 'Redo surface paint').props.disabled, false)
  await act(async () => button(renderer, 'Redo surface paint').props.onClick())
  await act(async () => button(renderer, 'Save surface').props.onClick())
  assert.equal(saved[0], 'Checker'); assert.equal(saved[1], 'floor')
  assert.deepEqual(saved[4].slice(0, 4), Array(4).fill('#5b4bdb'))
  await act(async () => renderer.unmount())
})

function SurfaceProbe() {
  const library = useSurfaceLibrary(), room = useSharedRoom()
  return <div>{library.items.map(item => item.name).join('|')} :: {room.data?.floorSurface?.name ?? 'default'} ::
    {room.data?.wallSurface?.name ?? 'default'}</div>
}
const probeText = (renderer: any) => renderer.root.findByType('div').children.join('')
test('surface and home realtime events update library and applied room without reload', async () => {
  mock.reset(); signIn()
  let renderer: any
  await act(async () => { renderer = create(<AuthProvider><SurfaceProbe /></AuthProvider>); await settle() })
  assert.match(probeText(renderer), /default/)
  const floor = await createSurface('Tiles', 'floor', 2, 2, pixels)
  await act(async () => { mock.emitRealtime('surfaces', 'INSERT', floor); await settle() })
  assert.match(probeText(renderer), /Tiles/)
  await applySurface(floor.id, 'floor')
  await act(async () => { mock.emitRealtime('homes', 'UPDATE', mock.home); await settle() })
  assert.match(probeText(renderer), /Tiles :: Tiles/)
  await updateSurface(floor.id, 'Renamed', 'floor', 2, 2, pixels)
  await act(async () => { mock.emitRealtime('surfaces', 'UPDATE', mock.surfaces.get(floor.id)); await settle() })
  assert.match(probeText(renderer), /Renamed :: Renamed/)
  assert.equal((probeText(renderer).match(/Renamed :: Renamed/g) ?? []).length, 1)
  await deleteSurface(floor.id)
  await act(async () => { mock.emitRealtime('surfaces', 'DELETE', { id: floor.id }); await settle() })
  assert.doesNotMatch(probeText(renderer), /Renamed/)
  assert.match(probeText(renderer), /default/)
  await act(async () => renderer.unmount())
  assert.equal(mock.channels.size, 0)
})

test('room toolbar applies floor and wall designs without remounting the scene', async () => {
  mock.reset(); signIn()
  const floor = await createSurface('Floor tiles', 'floor', 2, 2, pixels)
  const wall = await createSurface('Wall stripes', 'wall', 2, 2, pixels)
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter initialEntries={['/room']}><AuthProvider><App /></AuthProvider></MemoryRouter>) })
  const scene = () => renderer.root.findByType(SharedRoomScene)
  const firstScene = scene()
  assert.equal(scene().props.floorSurface, null)
  await act(async () => button(renderer, 'Open surface picker').props.onClick())
  assert.ok(renderer.root.findByProps({ 'aria-label': 'Choose room surfaces' }))
  await act(async () => button(renderer, 'Apply Floor tiles to floor').props.onClick())
  assert.equal(mock.home.floor_surface_id, floor.id)
  assert.equal(scene().props.floorSurface?.id, floor.id)
  assert.equal(scene(), firstScene)
  await act(async () => button(renderer, 'Open surface picker').props.onClick())
  await act(async () => button(renderer, 'Apply Wall stripes to walls').props.onClick())
  assert.equal(mock.home.wall_surface_id, wall.id)
  assert.equal(scene().props.wallSurface?.id, wall.id)
  assert.equal(scene(), firstScene)
  await act(async () => button(renderer, 'Open surface picker').props.onClick())
  await act(async () => button(renderer, 'Use default floor').props.onClick())
  assert.equal(scene().props.floorSurface, null)
  assert.equal(scene().props.wallSurface?.id, wall.id)
  await act(async () => renderer.unmount())
})
