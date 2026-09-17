import { InstancedMesh, Matrix4, Plane, Raycaster, Vector2, Vector3, type Camera } from 'three'
import { coordinateKey, DEFAULT_VOXEL_SIZE, inBounds, type Coordinate, type EditMode, type Voxel, type VoxelModel, type VoxelSize } from './model'

export type Axis = 'x' | 'y' | 'z'
export interface StrokeTarget { at: Coordinate; plane: Plane; lockedAxis: Axis; lockedValue: number }
export interface FaceTarget { at: Coordinate; face: string; normal: Coordinate }
const raycaster = new Raycaster()
const pointer = new Vector2()
const intersection = new Vector3()
const floorPlane = new Plane(new Vector3(0, 1, 0), 0)
const forward = new Vector3()

export function cameraPlaneAxis(camera: Camera): Axis {
  camera.getWorldDirection(forward)
  const x = Math.abs(forward.x), y = Math.abs(forward.y), z = Math.abs(forward.z)
  return x >= y && x >= z ? 'x' : y >= z ? 'y' : 'z'
}

export function voxelPlaneTarget(voxel: Coordinate, axis: Axis, mode: EditMode, cameraForward: Vector3,
  size: VoxelSize = DEFAULT_VOXEL_SIZE): Coordinate | null {
  const at = { x: voxel.x, y: voxel.y, z: voxel.z }
  if (mode === 'add') at[axis] += cameraForward[axis] < 0 ? 1 : -1
  return inBounds(at, size) ? at : null
}
export function floorTarget(x: number, z: number, size: VoxelSize = DEFAULT_VOXEL_SIZE): Coordinate | null {
  const at = { x: Math.floor(x + size[0] / 2), y: 0, z: Math.floor(z + size[2] / 2) }
  return inBounds(at, size) ? at : null
}

/** A raycast-only copy; live Add edits cannot turn into new stroke surfaces. */
export function createStrokeSnapshotMesh(source: InstancedMesh, voxels: readonly Voxel[], size: VoxelSize): InstancedMesh {
  const snapshot = new InstancedMesh(source.geometry, source.material, Math.max(voxels.length, 1))
  snapshot.count = voxels.length
  const matrix = new Matrix4()
  voxels.forEach((voxel, index) => {
    matrix.makeTranslation(voxel.x + 0.5 - size[0] / 2, voxel.y + 0.5, voxel.z + 0.5 - size[2] / 2)
    snapshot.setMatrixAt(index, matrix)
  })
  source.updateMatrixWorld(true)
  snapshot.matrixWorld.copy(source.matrixWorld)
  snapshot.computeBoundingSphere()
  return snapshot
}

/** Stroke editing follows the visible voxel face at every pointer sample. */
export function pickFaceTarget(clientX: number, clientY: number, rect: DOMRect, camera: Camera,
  mesh: InstancedMesh, voxels: readonly Voxel[], mode: EditMode, size: VoxelSize = DEFAULT_VOXEL_SIZE): FaceTarget | null {
  setRay(clientX, clientY, rect, camera)
  const hit = raycaster.intersectObject(mesh)[0]
  const floor = raycaster.ray.intersectPlane(floorPlane, intersection)
  if (hit && (!floor || hit.distance <= floor.distanceTo(raycaster.ray.origin))) {
    const voxel = hit.instanceId === undefined ? undefined : voxels[hit.instanceId]
    const normal = hit.face?.normal
    if (!voxel || !normal) return null
    const axis: Axis = Math.abs(normal.x) > 0.5 ? 'x' : Math.abs(normal.y) > 0.5 ? 'y' : 'z'
    const side = Math.sign(normal[axis])
    const offset = { x: 0, y: 0, z: 0 }
    offset[axis] = side
    const at = { x: voxel.x, y: voxel.y, z: voxel.z }
    if (mode === 'add') at[axis] += side
    return inBounds(at, size) ? { at, face: `${axis}:${side}:${at[axis]}`, normal: offset } : null
  }
  const at = mode === 'add' && floor ? floorTarget(floor.x, floor.z, size) : null
  return at ? { at, face: 'floor', normal: { x: 0, y: 1, z: 0 } } : null
}

function setRay(clientX: number, clientY: number, rect: DOMRect, camera: Camera) {
  pointer.set(
    (clientX - rect.left) / rect.width * 2 - 1,
    -(clientY - rect.top) / rect.height * 2 + 1,
  )
  raycaster.setFromCamera(pointer, camera)
}

function planeFor(axis: Axis, value: number, size: VoxelSize) {
  const normal = axis === 'x' ? new Vector3(1, 0, 0) : axis === 'y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
  const worldValue = axis === 'y' ? value : value - size[axis === 'x' ? 0 : 2] / 2 + 0.5
  return new Plane(normal, -worldValue)
}

export function pickStrokeStart(clientX: number, clientY: number, rect: DOMRect, camera: Camera,
  mesh: InstancedMesh, voxels: readonly Voxel[], mode: EditMode, size: VoxelSize = DEFAULT_VOXEL_SIZE): StrokeTarget | null {
  const lockedAxis = cameraPlaneAxis(camera)
  camera.getWorldDirection(forward)
  setRay(clientX, clientY, rect, camera)
  const hit = raycaster.intersectObject(mesh)[0]
  const floor = raycaster.ray.intersectPlane(floorPlane, intersection)
  if (hit && (!floor || hit.distance <= floor.distanceTo(raycaster.ray.origin))) {
    const voxel = hit.instanceId === undefined ? undefined : voxels[hit.instanceId]
    if (!voxel) return null
    const at = voxelPlaneTarget(voxel, lockedAxis, mode, forward, size)
    if (!at) return null
    return { at, plane: planeFor(lockedAxis, at[lockedAxis], size), lockedAxis, lockedValue: at[lockedAxis] }
  }
  const at = mode === 'add' && floor ? floorTarget(floor.x, floor.z, size) : null
  return at ? { at, plane: planeFor(lockedAxis, at[lockedAxis], size), lockedAxis, lockedValue: at[lockedAxis] } : null
}

export function pickLockedTarget(clientX: number, clientY: number, rect: DOMRect, camera: Camera,
  stroke: StrokeTarget, clampToBounds = false, size: VoxelSize = DEFAULT_VOXEL_SIZE): Coordinate | null {
  setRay(clientX, clientY, rect, camera)
  const point = raycaster.ray.intersectPlane(stroke.plane, intersection)
  if (!point) return null
  const at = {
    x: Math.floor(point.x + size[0] / 2),
    y: Math.floor(point.y),
    z: Math.floor(point.z + size[2] / 2),
  }
  at[stroke.lockedAxis] = stroke.lockedValue
  if (clampToBounds) for (const axis of ['x', 'y', 'z'] as const)
    at[axis] = Math.max(0, Math.min(size[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] - 1, at[axis]))
  return inBounds(at, size) ? at : null
}

export function rectangleCoordinates(start: Coordinate, end: Coordinate, lockedAxis: Axis,
  size: VoxelSize = DEFAULT_VOXEL_SIZE): Coordinate[] {
  const axes = (['x', 'y', 'z'] as const).filter(axis => axis !== lockedAxis)
  const cells: Coordinate[] = []
  for (let a = Math.min(start[axes[0]], end[axes[0]]); a <= Math.max(start[axes[0]], end[axes[0]]); a++)
    for (let b = Math.min(start[axes[1]], end[axes[1]]); b <= Math.max(start[axes[1]], end[axes[1]]); b++) {
      const at = { ...start, [axes[0]]: a, [axes[1]]: b }
      if (inBounds(at, size)) cells.push(at)
    }
  return cells
}

export function rectanglePreview(start: Coordinate, end: Coordinate, lockedAxis: Axis,
  model: VoxelModel, mode: EditMode, color: string, size: VoxelSize = DEFAULT_VOXEL_SIZE): Voxel[] {
  return rectangleCoordinates(start, end, lockedAxis, size)
    .filter(at => mode === 'add' ? !model.has(coordinateKey(at)) : model.has(coordinateKey(at)))
    .map(at => ({ ...at, color: mode === 'delete' ? '#c3304b' : color }))
}

export function interpolateCoordinates(from: Coordinate, to: Coordinate): Coordinate[] {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z))
  if (!steps) return [to]
  const result: Coordinate[] = []
  for (let step = 1; step <= steps; step += 1) {
    const at = {
      x: Math.round(from.x + (to.x - from.x) * step / steps),
      y: Math.round(from.y + (to.y - from.y) * step / steps),
      z: Math.round(from.z + (to.z - from.z) * step / steps),
    }
    if (!result.length || result.at(-1)?.x !== at.x || result.at(-1)?.y !== at.y || result.at(-1)?.z !== at.z) result.push(at)
  }
  return result
}

export function strokeCoordinates(from: FaceTarget, to: FaceTarget): Coordinate[] {
  return from.face === to.face ? interpolateCoordinates(from.at, to.at) : [to.at]
}

export function supportedStrokeAdd(at: Coordinate, target: FaceTarget, strokeStart: ReadonlySet<string>): boolean {
  if (target.face === 'floor') return at.y === 0
  return strokeStart.has(coordinateKey({ x: at.x - target.normal.x, y: at.y - target.normal.y, z: at.z - target.normal.z }))
}
