import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { App } from '../src/app/App'
import { LocalVoxelEditor } from '../src/routes/FurnitureEditorPage'
import { VoxelEditorScene } from './mockVoxelScene'
import { mock } from './mockSupabase'
import { identities } from '../src/features/auth/identities'
import { createFurniture, listFurniture, getFurniture, updateFurniture, countPlacedInstances, deleteFurniture, PlacementCountChangedError } from '../src/features/furniture/data'
import { editModel, serializeModel } from '../src/features/voxel/model'
import { renderFurnitureThumbnail } from '../src/features/furniture/thumbnail'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const model = editModel(new Map(), 'add', { x: 5, y: 0, z: 5 }, '#8b5e3c')
const signIn = (index: number) => { mock.session = { user: { id: index ? 'user-two' : 'user-one', email: identities[index].email } } }
const button = (renderer: any, label: string) => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === label)
const edit = async (renderer: any, at: { x: number; y: number; z: number }) => act(async () => {
  const scene = renderer.root.findByType(VoxelEditorScene).props
  scene.onStrokeStart(); scene.onStrokeEdit(at); scene.onStrokeEnd()
})
async function mount(path: string) {
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>) })
  return renderer
}

test('CRUD uses resolved home and authenticated creator; second user reads/updates same record', async () => {
  mock.reset(); signIn(0)
  const created = await createFurniture(' Chair ', model)
  assert.equal(created.name, 'Chair'); assert.equal(created.creator_id, 'user-one'); assert.equal(created.home_id, 'shared-home')
  signIn(1)
  const library = await listFurniture()
  assert.equal(library[0].id, created.id); assert.equal(library[0].creator?.display_name, 'Ben')
  assert.equal(serializeModel(model), JSON.stringify((await getFurniture(created.id)).voxel_data))
  const painted = editModel(model, 'paint', { x: 5, y: 0, z: 5 }, '#ffffff')
  const updated = await updateFurniture(created.id, 'Renamed', painted)
  assert.equal(updated.id, created.id); assert.equal(updated.creator_id, 'user-one')
  assert.equal(updated.updated_at, '2026-09-15T01:00:00Z'); assert.equal(mock.furniture.size, 1)
  assert.deepEqual((await getFurniture(created.id)).voxel_data, JSON.parse(serializeModel(painted)))
  const update = mock.queryCalls.find(call => call.operation === 'update')
  assert.deepEqual(Object.keys(update.values).sort(), ['name', 'size_x', 'size_y', 'size_z', 'thumbnail_path', 'voxel_data'])
  for (const call of mock.queryCalls.filter(call => call.table === 'furniture' && call.operation !== 'insert'))
    assert.ok(call.filters.some(([column, value]: any[]) => column === 'home_id' && value === 'shared-home'))
})
test('thumbnail renders once at create/design edit, uses Storage paths, and survives image failure', async () => {
  mock.reset(); signIn(0)
  const originalDocument = globalThis.document
  const faces: string[] = []
  ;(globalThis as any).document = { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ fillStyle: '', beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() { faces.push('face') } }),
    toBlob(callback: (blob: Blob) => void) { callback(new Blob(['image'], { type: 'image/webp' })) },
  }) }
  try {
    const blob = await renderFurnitureThumbnail(model)
    assert.equal(blob.type, 'image/webp'); assert.ok(faces.length > 0)
    const created = await createFurniture('Thumb chair', model)
    assert.match(created.thumbnail_path!, /^shared-home\/furniture-1\/.+\.webp$/)
    assert.equal(mock.storageFiles.size, 1)
    const sameDesign = await updateFurniture(created.id, 'New name', model)
    assert.equal(sameDesign.thumbnail_path, created.thumbnail_path)
    assert.equal(mock.storageCalls.filter(call => call.operation === 'upload').length, 1)
    const painted = editModel(model, 'paint', { x: 5, y: 0, z: 5 }, '#ffffff')
    const changed = await updateFurniture(created.id, 'New name', painted)
    assert.notEqual(changed.thumbnail_path, created.thumbnail_path)
    assert.equal(mock.storageFiles.size, 1, 'replaced thumbnail is cleaned up')
    mock.storageError = { message: 'Storage offline' }
    const failed = await updateFurniture(created.id, 'New name', model)
    assert.equal(failed.thumbnail_path, null, 'older design image is not displayed after failure')
    assert.deepEqual((await getFurniture(created.id)).voxel_data, JSON.parse(serializeModel(model)))
  } finally { (globalThis as any).document = originalDocument }
})
test('library uses a signed thumbnail image and falls back if the image cannot load', async () => {
  mock.reset(); signIn(0)
  mock.furniture.set('preview-1', { id: 'preview-1', home_id: 'shared-home', creator_id: 'user-one', name: 'Chair',
    thumbnail_path: 'shared-home/preview-1/image.webp', created_at: '', updated_at: '' })
  mock.storageFiles.set('shared-home/preview-1/image.webp', new Blob(['image'], { type: 'image/webp' }))
  const renderer = await mount('/furniture')
  const image = renderer.root.findByType('img')
  assert.equal(image.props.alt, 'Chair preview')
  assert.match(image.props.src, /shared-home\/preview-1\/image.webp$/)
  await act(async () => image.props.onError())
  assert.equal(renderer.root.findAllByType('img').length, 0)
  await act(async () => renderer.unmount())
})
test('empty names/models, logged-out access, missing membership and inaccessible records fail', async () => {
  mock.reset(); signIn(0)
  for (const operation of [() => createFurniture('  ', model), () => createFurniture('Chair', new Map()),
    () => updateFurniture('id', '', model), () => updateFurniture('id', 'Chair', new Map())]) await assert.rejects(operation)
  assert.equal(mock.queryCalls.length, 0)
  mock.session = null; await assert.rejects(() => listFurniture()); await assert.rejects(() => createFurniture('Chair', model))
  signIn(0); mock.membership = null; await assert.rejects(() => listFurniture())
  mock.membership = { home_id: 'shared-home' }; await assert.rejects(() => getFurniture('missing'), /not accessible/)
})
test('delete counts copies, fails closed and requests reconfirmation when count changes', async () => {
  mock.reset(); signIn(0)
  const row = await createFurniture('Chair', model)
  mock.placedCounts.set(row.id, 2)
  assert.equal(await countPlacedInstances(row.id), 2)
  await assert.rejects(() => deleteFurniture(row.id, 0), PlacementCountChangedError)
  assert.equal(mock.furniture.size, 1)
  mock.countError = { message: 'Offline' }
  await assert.rejects(() => deleteFurniture(row.id, 2)); assert.equal(mock.furniture.size, 1)
  mock.countError = null
  await deleteFurniture(row.id, 2); assert.equal(mock.furniture.size, 0); assert.equal(mock.placedCounts.has(row.id), false)
})
test('saved editor loads name/model; save changes updates record and returns to library', async () => {
  mock.reset(); signIn(0)
  const row = await createFurniture('Chair', model)
  signIn(1)
  const renderer = await mount(`/furniture/${row.id}/edit`)
  const scene = renderer.root.findByType(VoxelEditorScene).props
  assert.equal(serializeModel(scene.model), serializeModel(model))
  const input = renderer.root.findAllByType('input').find((node: any) => node.props.placeholder)
  assert.equal(input.props.value, 'Chair')
  await act(async () => input.props.onChange({ target: { value: 'Updated chair' } }))
  await act(async () => button(renderer, 'Save changes').props.onClick())
  assert.equal(mock.furniture.get(row.id).name, 'Updated chair')
  assert.equal(mock.furniture.size, 1)
  assert.match(JSON.stringify(renderer.toJSON()), /Furniture/)
  await act(async () => renderer.unmount())
})
test('library shows creator, cancel is safe, changed count renews warning, confirm deletes', async () => {
  mock.reset(); signIn(0)
  const row = await createFurniture('Chair', model); mock.placedCounts.set(row.id, 2)
  signIn(1)
  const renderer = await mount('/furniture')
  assert.match(JSON.stringify(renderer.toJSON()), /Created by.*Ben/)
  await act(async () => button(renderer, 'Delete Chair').props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /also remove 2 placed copies/)
  await act(async () => button(renderer, 'Cancel delete').props.onClick()); assert.equal(mock.furniture.size, 1)
  await act(async () => button(renderer, 'Delete Chair').props.onClick())
  mock.placedCounts.set(row.id, 3)
  await act(async () => button(renderer, 'Confirm delete').props.onClick()); assert.equal(mock.furniture.size, 1)
  assert.match(JSON.stringify(renderer.toJSON()), /also remove 3 placed copies/)
  await act(async () => button(renderer, 'Confirm delete').props.onClick()); assert.equal(mock.furniture.size, 0)
  assert.match(JSON.stringify(renderer.toJSON()), /No furniture yet/)
  await act(async () => renderer.unmount())
})
test('new editor validates before save; duplicate clicks blocked; errors retain draft', async () => {
  let renderer: any
  let calls = 0
  let rejectSave: any
  await act(async () => { renderer = create(<MemoryRouter><LocalVoxelEditor onSave={() => { calls++; return new Promise((_resolve, reject) => { rejectSave = reject }) }} /></MemoryRouter>) })
  await act(async () => button(renderer, 'Save furniture').props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /Enter a furniture name/)
  const input = renderer.root.findAllByType('input').find((node: any) => node.props.placeholder)
  await act(async () => input.props.onChange({ target: { value: 'Chair' } }))
  await act(async () => button(renderer, 'Save furniture').props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /Add at least one voxel/)
  const scene = () => renderer.root.findByType(VoxelEditorScene).props
  await edit(renderer, { x: 5, y: 0, z: 5 })
  const saveButton = button(renderer, 'Save furniture')
  await act(async () => { void saveButton.props.onClick(); void saveButton.props.onClick() })
  assert.equal(calls, 1); assert.equal(renderer.root.findByType('fieldset').props.disabled, true)
  await act(async () => rejectSave(new Error('Offline')))
  assert.equal(scene().model.size, 1); assert.match(JSON.stringify(renderer.toJSON()), /Offline/)
  await act(async () => renderer.unmount())
})

test('new-route save persists through component restart and second-user library reload', async () => {
  mock.reset(); signIn(0)
  const renderer = await mount('/furniture/new')
  const input = renderer.root.findAllByType('input').find((node: any) => node.props.placeholder)
  await act(async () => input.props.onChange({ target: { value: 'Saved chair' } }))
  await edit(renderer, { x: 5, y: 0, z: 5 })
  await act(async () => button(renderer, 'Save furniture').props.onClick())
  assert.equal(mock.furniture.size, 1)
  assert.match(JSON.stringify(renderer.toJSON()), /Saved chair/)
  await act(async () => renderer.unmount())
  signIn(1)
  const reopened = await mount('/furniture')
  assert.match(JSON.stringify(reopened.toJSON()), /Saved chair/)
  assert.equal(mock.furniture.size, 1)
  await act(async () => reopened.unmount())
})

test('library refresh discovers external changes; load/count/delete errors are visible and safe', async () => {
  mock.reset(); signIn(0)
  const renderer = await mount('/furniture')
  assert.match(JSON.stringify(renderer.toJSON()), /No furniture yet/)
  const row = await createFurniture('Later chair', model)
  await act(async () => button(renderer, 'Refresh furniture').props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /Later chair/)
  mock.countError = { message: 'Offline' }
  await act(async () => button(renderer, 'Delete Later chair').props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /Deletion has not started/)
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
  mock.countError = null
  await act(async () => button(renderer, 'Delete Later chair').props.onClick())
  mock.furnitureError = { message: 'Permission denied' }
  await act(async () => button(renderer, 'Confirm delete').props.onClick())
  assert.equal(mock.furniture.has(row.id), true)
  assert.match(JSON.stringify(renderer.toJSON()), /Unable to delete furniture/)
  await act(async () => button(renderer, 'Cancel delete').props.onClick())
  await act(async () => button(renderer, 'Refresh furniture').props.onClick())
  assert.match(JSON.stringify(renderer.toJSON()), /Unable to load furniture/)
  await act(async () => renderer.unmount())
})
