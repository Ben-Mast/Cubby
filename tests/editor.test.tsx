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
  const button = (text: string) => renderer.root.findAllByType('button').find((node: any) => node.children.includes(text))
  const click = async (text: string) => act(async () => button(text).props.onClick())
  const at = { x: 5, y: 0, z: 5 }
  await act(async () => scene().onEdit(at))
  assert.equal(scene().model.size, 1)
  await act(async () => scene().onEdit(at))
  assert.equal(scene().model.size, 1)
  await click('Camera'); assert.equal(scene().cameraMode, true)
  await click('Paint'); assert.equal(scene().cameraMode, false); assert.equal(scene().mode, 'paint')
  await act(async () => renderer.root.findAllByType('button').find((node: any) => node.props['aria-label'] === 'Color #5b4bdb').props.onClick())
  await act(async () => scene().onEdit(at))
  assert.equal(scene().model.get(coordinateKey(at)).color, '#5b4bdb')
  await click('Undo'); assert.equal(scene().model.get(coordinateKey(at)).color, '#8b5e3c')
  await click('Redo'); assert.equal(scene().model.get(coordinateKey(at)).color, '#5b4bdb')
  await act(async () => renderer.root.findAllByType('input').find((node: any) => node.props.placeholder).props.onChange({ target: { value: 'Chair' } }))
  const before = serializeModel(scene().model)
  await click('Capture snapshot')
  assert.equal(JSON.parse(renderer.root.findByType('textarea').props.value).name, 'Chair')
  await click('Clear'); assert.equal(scene().model.size, 0)
  await click('Undo'); assert.equal(serializeModel(scene().model), before)
  await click('Redo'); assert.equal(scene().model.size, 0)
  await click('Restore snapshot'); assert.equal(serializeModel(scene().model), before)
  await click('Delete'); await act(async () => scene().onEdit(at)); assert.equal(scene().model.size, 0)
  await click('Undo'); assert.equal(serializeModel(scene().model), before)
  await click('Redo'); assert.equal(scene().model.size, 0)
  await act(async () => renderer.unmount())
})
