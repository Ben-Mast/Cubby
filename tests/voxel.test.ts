import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Plane, Vector3 } from 'three'
import { coordinateKey, deserializeModel, editModel, editRectangle, emptyHistory, historyReducer, HISTORY_LIMIT, inBounds, serializeModel, type VoxelModel } from '../src/features/voxel/model'
import { cameraPlaneAxis, floorTarget, interpolateCoordinates, pickLockedTarget, pickStrokeStart, rectangleCoordinates, rectanglePreview, voxelPlaneTarget } from '../src/features/voxel/targeting'
import { bindPrimaryPointerInput } from '../src/features/voxel/input'

const at = { x: 8, y: 0, z: 8 }
const brown = '#8b5e3c'
test('add, delete and paint are immutable and cannot duplicate occupancy', () => {
  const empty: VoxelModel = new Map()
  const added = editModel(empty, 'add', at, brown)
  assert.equal(empty.size, 0)
  assert.equal(added.size, 1)
  assert.equal(editModel(added, 'add', at, '#ffffff'), added)
  assert.equal(editModel(empty, 'paint', at, brown), empty)
  assert.equal(editModel(empty, 'delete', at, brown), empty)
  const painted = editModel(added, 'paint', at, '#ffffff')
  assert.equal(painted.get(coordinateKey(at))?.color, '#ffffff')
  assert.equal(added.get(coordinateKey(at))?.color, brown)
  assert.equal(editModel(painted, 'delete', at, brown).size, 0)
})
test('all six bounds and fractional/nonfinite coordinates reject edits', () => {
  for (const axis of ['x', 'y', 'z']) for (const value of [-1, 16, 1.5, NaN, Infinity]) {
    const bad = { ...at, [axis]: value }
    assert.equal(inBounds(bad), false)
    const model = new Map()
    assert.equal(editModel(model, 'add', bad, brown), model)
  }
  assert.ok(inBounds({ x: 15, y: 15, z: 15 }))
})
test('floor targeting and camera-facing adjacent Add slices respect all six bounds', () => {
  assert.deepEqual(floorTarget(-7.9, 7.9), { x: 0, y: 0, z: 15 })
  assert.equal(floorTarget(8, 0), null)
  assert.equal(floorTarget(-8.01, 0), null)
  for (const axis of ['x', 'y', 'z']) for (const direction of [-1, 1]) {
    const origin = { x: 8, y: 8, z: 8 }
    const forward = new Vector3(0, 0, 0); forward[axis as 'x' | 'y' | 'z'] = -direction
    assert.deepEqual(voxelPlaneTarget(origin, axis as 'x' | 'y' | 'z', 'add', forward), { ...origin, [axis]: 8 + direction })
    assert.deepEqual(voxelPlaneTarget(origin, axis as 'x' | 'y' | 'z', 'paint', forward), origin)
    assert.deepEqual(voxelPlaneTarget(origin, axis as 'x' | 'y' | 'z', 'delete', forward), origin)
    assert.equal(voxelPlaneTarget({ ...origin, [axis]: direction === -1 ? 0 : 15 }, axis as 'x' | 'y' | 'z', 'add', forward), null)
  }
})
test('camera forward chooses most face-on XY, XZ or YZ plane and changes after orbit', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 150)
  const axisAt = (x: number, y: number, z: number) => {
    camera.position.set(x, y, z); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
    return cameraPlaneAxis(camera)
  }
  assert.equal(axisAt(2, 4, 20), 'z')
  assert.equal(axisAt(-2, 4, -20), 'z')
  assert.equal(axisAt(2, 20, 4), 'y')
  assert.equal(axisAt(-2, -20, 4), 'y')
  assert.equal(axisAt(20, 4, 2), 'x')
  assert.equal(axisAt(-20, 4, -2), 'x')
  assert.equal(axisAt(15, 12, 8), 'x')
  assert.equal(axisAt(8, 15, 12), 'y')
  assert.equal(axisAt(8, 12, 15), 'z')
  assert.equal(axisAt(20, 4, 2), 'x', 'orbiting before the next gesture changes selection')
})
test('actual Three raycast picks instance faces and floor, not empty air', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 150)
  camera.position.set(0.5, 10, 0.5)
  camera.lookAt(0.5, 0, 0.5)
  camera.updateMatrixWorld()
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 4096)
  mesh.count = 1
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(0.5, 0.5, 0.5))
  mesh.computeBoundingSphere()
  mesh.updateMatrixWorld()
  const rect = { left: 0, top: 0, width: 500, height: 500 } as DOMRect
  const voxels = [{ ...at, color: brown }]
  const add = pickStrokeStart(250, 250, rect, camera, mesh, voxels, 'add')
  assert.deepEqual(add?.at, { ...at, y: 1 })
  assert.equal(add?.lockedAxis, 'y')
  assert.deepEqual(pickStrokeStart(250, 250, rect, camera, mesh, voxels, 'delete')?.at, at)
  assert.deepEqual(pickStrokeStart(250, 250, rect, camera, mesh, voxels, 'paint')?.at, at)
  mesh.count = 0; mesh.computeBoundingSphere()
  assert.deepEqual(pickStrokeStart(250, 250, rect, camera, mesh, [], 'add')?.at, at)
  assert.equal(pickStrokeStart(250, 250, rect, camera, mesh, [], 'paint'), null)
  camera.position.set(0.5, 5, 20); camera.lookAt(0.5, 0, 0.5); camera.updateMatrixWorld()
  assert.equal(pickStrokeStart(250, 250, rect, camera, mesh, [], 'add')?.lockedAxis, 'z',
    'floor chooses a slice but does not override camera-selected plane orientation')
  camera.position.set(0, 30, 30); camera.lookAt(new Vector3(30, 30, 30)); camera.updateMatrixWorld()
  assert.equal(pickStrokeStart(250, 250, rect, camera, mesh, [], 'add'), null)
  mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose()
})
test('undo/redo covers add, paint, delete, clear and restore; edits branch history', () => {
  let state = emptyHistory()
  const states = [state.present]
  for (const action of [
    { type: 'edit', mode: 'add', at, color: brown },
    { type: 'edit', mode: 'paint', at, color: '#ffffff' },
    { type: 'edit', mode: 'delete', at, color: brown },
    { type: 'edit', mode: 'add', at, color: brown },
    { type: 'clear' },
    { type: 'restore', model: states[0] },
  ] as const) { state = historyReducer(state, action); states.push(state.present) }
  for (let i = states.length - 2; i >= 0; i--) { state = historyReducer(state, { type: 'undo' }); assert.equal(state.present, states[i]) }
  for (let i = 1; i < states.length; i++) { state = historyReducer(state, { type: 'redo' }); assert.equal(state.present, states[i]) }
  state = historyReducer(state, { type: 'undo' })
  state = historyReducer(state, { type: 'edit', mode: 'add', at: { ...at, x: 9 }, color: brown })
  assert.equal(state.future.length, 0)
  assert.equal(historyReducer(emptyHistory(), { type: 'clear' }).past.length, 0)
  let bounded = emptyHistory()
  for (let i = 0; i < 150; i++) bounded = historyReducer(bounded, { type: 'edit', mode: 'add', at: { x: i % 16, y: Math.floor(i / 16), z: 0 }, color: brown })
  assert.equal(bounded.past.length, HISTORY_LIMIT)
})
test('canonical serialization round trips a recognizable 3D chair and full editor volume', () => {
  const chair = new Map()
  for (let x = 4; x < 10; x++) for (let z = 4; z < 10; z++) {
    const seat = { x, y: 4, z, color: brown }; chair.set(coordinateKey(seat), seat)
    for (let y = 0; y < 4; y++) if ([4, 9].includes(x) && [4, 9].includes(z)) {
      const leg = { x, y, z, color: brown }; chair.set(coordinateKey(leg), leg)
    }
    if (z === 4) for (let y = 5; y < 10; y++) {
      const back = { x, y, z, color: brown }; chair.set(coordinateKey(back), back)
    }
  }
  const json = serializeModel(chair)
  assert.equal(serializeModel(deserializeModel(json)), json)
  assert.equal(chair.size, 82)
  const full = new Map()
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) {
    const voxel = { x, y, z, color: brown }; full.set(coordinateKey(voxel), voxel)
  }
  assert.equal(deserializeModel(serializeModel(full)).size, 4096)
})
test('deserialization rejects invalid format, colors, out-of-bounds and duplicate voxels', () => {
  const voxel = { ...at, color: brown }
  for (const data of [null, {}, { version: 2, size: [16,16,16], voxels: [] },
    { version: 1, size: [32,16,16], voxels: [] },
    ...[[voxel, voxel], [{ ...voxel, x: 16 }], [{ ...voxel, y: -1 }], [{ ...voxel, z: 0.5 }],
      [{ ...voxel, color: 'red' }], [null]].map(voxels => ({ version: 1, size: [16,16,16], voxels }))])
    assert.throws(() => deserializeModel(JSON.stringify(data)))
})
test('stroke interpolation fills fast pointer samples and locked raycasts stay in one plane', () => {
  assert.deepEqual(interpolateCoordinates({ x: 1,y: 2,z: 3 }, { x: 5,y: 2,z: 3 }), [
    { x: 2,y: 2,z: 3 }, { x: 3,y: 2,z: 3 }, { x: 4,y: 2,z: 3 }, { x: 5,y: 2,z: 3 },
  ])
  const camera = new PerspectiveCamera(45, 1, 0.1, 150)
  camera.position.set(8, 10, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
  const target = { at: { x: 8,y: 4,z: 8 }, lockedAxis: 'y' as const, lockedValue: 4,
    plane: new Plane(new Vector3(0,1,0), -4) }
  assert.equal(pickLockedTarget(250, 250, { left: 0,top: 0,width: 500,height: 500 } as DOMRect, camera, target)?.y, 4)
  camera.position.set(20, 8, 0); camera.lookAt(0, 4, 0); camera.updateMatrixWorld()
  assert.equal(cameraPlaneAxis(camera), 'x')
  assert.equal(pickLockedTarget(250, 250, { left: 0,top: 0,width: 500,height: 500 } as DOMRect, camera, target)?.y, 4,
    'orbiting during a gesture does not change its locked slice')
})

test('rectangle preview tracks drag on one slice; Add/Delete/Paint each commit one undoable bulk action', () => {
  const start = { x: 3, y: 2, z: 5 }, end = { x: 5, y: 2, z: 6 }
  const cells = rectangleCoordinates(start, end, 'y')
  assert.equal(cells.length, 6)
  assert.ok(cells.every(cell => cell.y === 2))
  assert.equal(rectanglePreview(start, start, 'y', new Map(), 'add', brown).length, 1)
  assert.equal(rectanglePreview(start, end, 'y', new Map(), 'add', brown).length, 6)
  let state = emptyHistory()
  state = historyReducer(state, { type: 'rectangle', cells, mode: 'add', color: brown })
  assert.equal(state.present.size, 6)
  assert.equal(state.past.length, 1)
  assert.equal(rectanglePreview(start, end, 'y', state.present, 'add', brown).length, 0)
  assert.equal(editRectangle(state.present, 'add', [...cells, ...cells, { x: 16, y: 2, z: 5 }], brown), state.present)
  state = historyReducer(state, { type: 'undo' }); assert.equal(state.present.size, 0)
  state = historyReducer(state, { type: 'redo' }); assert.equal(state.present.size, 6)
  const paintPreview = rectanglePreview(start, end, 'y', state.present, 'paint', '#ffffff')
  assert.equal(paintPreview.length, 6)
  assert.ok(paintPreview.every(voxel => voxel.color === '#ffffff'))
  state = historyReducer(state, { type: 'rectangle', cells, mode: 'paint', color: '#ffffff' })
  assert.ok([...state.present.values()].every(voxel => voxel.color === '#ffffff'))
  assert.equal(state.past.length, 2)
  state = historyReducer(state, { type: 'undo' }); assert.ok([...state.present.values()].every(voxel => voxel.color === brown))
  state = historyReducer(state, { type: 'redo' }); assert.ok([...state.present.values()].every(voxel => voxel.color === '#ffffff'))
  assert.equal(rectanglePreview(start, end, 'y', state.present, 'delete', brown).length, 6)
  state = historyReducer(state, { type: 'rectangle', cells, mode: 'delete', color: brown })
  assert.equal(state.present.size, 0)
  assert.equal(state.past.length, 3)
  state = historyReducer(state, { type: 'undo' }); assert.equal(state.present.size, 6)
  state = historyReducer(state, { type: 'redo' }); assert.equal(state.present.size, 0)
  assert.equal(rectangleCoordinates({ x: 15, y: 0, z: 14 }, { x: 15, y: 0, z: 16 }, 'x').length, 2,
    'out-of-bounds cells are skipped')
  assert.equal(rectangleCoordinates({ x: 4, y: 2, z: 5 }, { x: 4, y: 4, z: 6 }, 'x').length, 6)
  assert.equal(rectangleCoordinates({ x: 4, y: 2, z: 5 }, { x: 6, y: 4, z: 5 }, 'z').length, 9)
})

test('one pointer edits continuously, second touch cancels for camera, and listeners clean up', () => {
  class TestCanvas extends EventTarget { setPointerCapture(_id: number) {} }
  for (const pointerType of ['mouse', 'touch']) {
    const canvas = new TestCanvas()
    const events: string[] = []
    const unbind = bindPrimaryPointerInput(canvas as unknown as HTMLCanvasElement, {
      start: () => { events.push('start'); return true }, move: () => events.push('move'),
      end: () => events.push('end'), cancel: () => events.push('cancel'),
    })
    const send = (type: string, pointerId = 1, clientX = 100, clientY = 200) => {
      const event = Object.assign(new Event(type), { pointerId, clientX, clientY, button: 0, pointerType })
      canvas.dispatchEvent(event)
    }
    send('pointerdown'); send('pointermove', 1, 150); send('pointerup')
    assert.deepEqual(events, ['start','move','end'])
    send('pointerdown'); send('pointerdown', 2); send('pointerup', 2); send('pointerup')
    assert.deepEqual(events.slice(-2), pointerType === 'touch' ? ['start','cancel'] : ['start','end'])
    send('pointerdown'); send('pointercancel'); send('pointerup')
    assert.equal(events.at(-1), 'cancel')
    const count = events.length
    unbind(); send('pointerdown'); send('pointerup')
    assert.equal(events.length, count)
  }
})

test('one continuous stroke is one undo/redo history entry', () => {
  let state = emptyHistory()
  state = historyReducer(state, { type: 'stroke-start' })
  for (const x of [1,2,3,4]) state = historyReducer(state, { type: 'stroke-edit', mode: 'add', at: { x,y: 0,z: 0 }, color: brown })
  state = historyReducer(state, { type: 'stroke-end' })
  assert.equal(state.present.size, 4)
  assert.equal(state.past.length, 1)
  state = historyReducer(state, { type: 'undo' }); assert.equal(state.present.size, 0)
  state = historyReducer(state, { type: 'redo' }); assert.equal(state.present.size, 4)
})
