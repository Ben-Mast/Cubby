import { test } from 'node:test'
import assert from 'node:assert/strict'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { LocalVoxelEditor } from '../src/routes/FurnitureEditorPage'
import { VoxelEditorScene } from './mockVoxelScene'
import { coordinateKey, serializeModel } from '../src/features/voxel/model'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
test('editor UI wires modes, colors, history, name and local snapshot restore', async () => {
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter><LocalVoxelEditor /></MemoryRouter>) })
  const scene = () => renderer.root.findByType(VoxelEditorScene).props
  const button = (label: string) => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === label)
  const click = async (label: string) => act(async () => button(label).props.onClick())
  const at = { x: 5, y: 0, z: 5 }
  const stroke = async (points: typeof at[]) => act(async () => {
    scene().onStrokeStart(); for (const point of points) scene().onStrokeEdit(point); scene().onStrokeEnd()
  })
  await stroke([at])
  assert.equal(scene().model.size, 1)
  await stroke([at])
  assert.equal(scene().model.size, 1)
  await click('Paint voxel'); assert.equal(scene().mode, 'paint')
  await click('Choose voxel color')
  await act(async () => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === 'Color #5b4bdb').props.onClick())
  await stroke([at])
  assert.equal(scene().model.get(coordinateKey(at)).color, '#5b4bdb')
  await click('Undo'); assert.equal(scene().model.get(coordinateKey(at)).color, '#8b5e3c')
  await click('Redo'); assert.equal(scene().model.get(coordinateKey(at)).color, '#5b4bdb')
  await act(async () => renderer.root.findAllByType('input').find((node: any) => node.props.placeholder).props.onChange({ target: { value: 'Chair' } }))
  const before = serializeModel(scene().model)
  await click('Capture local snapshot')
  assert.equal(JSON.parse(renderer.root.findByType('textarea').props.value).name, 'Chair')
  await click('Clear furniture'); assert.equal(scene().model.size, 0)
  await click('Undo'); assert.equal(serializeModel(scene().model), before)
  await click('Redo'); assert.equal(scene().model.size, 0)
  await click('Restore local snapshot'); assert.equal(serializeModel(scene().model), before)
  await click('Delete voxel'); await stroke([at]); assert.equal(scene().model.size, 0)
  await click('Undo'); assert.equal(serializeModel(scene().model), before)
  await click('Redo'); assert.equal(scene().model.size, 0)
  await act(async () => renderer.unmount())
})

test('editor cycles Stroke/Rectangle brushes and commits each rectangle as one history action', async () => {
  let renderer: any
  await act(async () => { renderer = create(<MemoryRouter><LocalVoxelEditor onSave={async () => {}} /></MemoryRouter>) })
  const scene = () => renderer.root.findByType(VoxelEditorScene).props
  const button = (label: string) => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === label)
  const click = async (label: string) => act(async () => button(label).props.onClick())
  const cells = [{ x: 3, y: 1, z: 5 }, { x: 4, y: 1, z: 5 }, { x: 3, y: 1, z: 6 }, { x: 4, y: 1, z: 6 }]
  assert.equal(scene().brushMode, 'stroke')
  assert.deepEqual(renderer.root.findByProps({ 'aria-label': 'Editing tools' }).findAllByType('button').map((node: any) => node.props['aria-label']),
    ['Camera mode', 'Add voxel', 'Delete voxel', 'Paint voxel', 'Brush mode: Stroke'])
  await click('Camera mode'); assert.equal(scene().mode, 'camera')
  assert.equal(button('Camera mode').props['aria-pressed'], true)
  await click('Add voxel'); assert.equal(scene().mode, 'add')
  await click('Brush mode: Stroke'); assert.equal(scene().brushMode, 'rectangle')
  await act(async () => scene().onRectangle(cells, 'add', '#8b5e3c'))
  assert.equal(scene().model.size, 4)
  await click('Undo'); assert.equal(scene().model.size, 0)
  await click('Redo'); assert.equal(scene().model.size, 4)
  await click('Paint voxel')
  await act(async () => scene().onRectangle(cells, 'paint', '#ffffff'))
  assert.ok([...scene().model.values()].every((voxel: any) => voxel.color === '#ffffff'))
  await click('Delete voxel')
  await act(async () => scene().onRectangle(cells, 'delete', '#ffffff'))
  assert.equal(scene().model.size, 0)
  await click('Undo'); assert.equal(scene().model.size, 4)
  await click('Brush mode: Rectangle Fill'); assert.equal(scene().brushMode, 'stroke')
  const top = renderer.root.findByProps({ className: 'editor-topbar' }).findAllByType('button').map((node: any) => node.props['aria-label'])
  assert.ok(top.indexOf('Clear furniture') >= 0)
  assert.equal(top.indexOf('Save furniture'), top.indexOf('Clear furniture') + 1)
  await click('Clear furniture'); assert.equal(scene().model.size, 0)
  await click('Undo'); assert.equal(scene().model.size, 4)
  await act(async () => renderer.unmount())
})
