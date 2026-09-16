import { Plane, Raycaster, Vector2, Vector3, type Camera, type InstancedMesh } from 'three'
import { coordinateKey, EDITOR_SIZE, inBounds, type Coordinate, type EditMode, type Voxel, type VoxelModel } from './model'

export type Axis = 'x' | 'y' | 'z'
export interface StrokeTarget { at: Coordinate; plane: Plane; lockedAxis: Axis; lockedValue: number }
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

export function voxelPlaneTarget(voxel: Coordinate, axis: Axis, mode: EditMode, cameraForward: Vector3): Coordinate | null {
  const at = { x: voxel.x, y: voxel.y, z: voxel.z }
  if (mode === 'add') at[axis] += cameraForward[axis] < 0 ? 1 : -1
  return inBounds(at) ? at : null
}
export function floorTarget(x: number, z: number): Coordinate | null {
  const at = { x: Math.floor(x + EDITOR_SIZE / 2), y: 0, z: Math.floor(z + EDITOR_SIZE / 2) }
  return inBounds(at) ? at : null
}

function setRay(clientX: number, clientY: number, rect: DOMRect, camera: Camera) {
  pointer.set(
    (clientX - rect.left) / rect.width * 2 - 1,
    -(clientY - rect.top) / rect.height * 2 + 1,
  )
  raycaster.setFromCamera(pointer, camera)
}

function planeFor(axis: Axis, value: number) {
  const normal = axis === 'x' ? new Vector3(1, 0, 0) : axis === 'y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
  const worldValue = axis === 'y' ? value : value - EDITOR_SIZE / 2 + 0.5
  return new Plane(normal, -worldValue)
}

export function pickStrokeStart(clientX: number, clientY: number, rect: DOMRect, camera: Camera,
  mesh: InstancedMesh, voxels: readonly Voxel[], mode: EditMode): StrokeTarget | null {
  const lockedAxis = cameraPlaneAxis(camera)
  camera.getWorldDirection(forward)
  setRay(clientX, clientY, rect, camera)
  const hit = raycaster.intersectObject(mesh)[0]
  const floor = raycaster.ray.intersectPlane(floorPlane, intersection)
  if (hit && (!floor || hit.distance <= floor.distanceTo(raycaster.ray.origin))) {
    const voxel = hit.instanceId === undefined ? undefined : voxels[hit.instanceId]
    if (!voxel) return null
    const at = voxelPlaneTarget(voxel, lockedAxis, mode, forward)
    if (!at) return null
    return { at, plane: planeFor(lockedAxis, at[lockedAxis]), lockedAxis, lockedValue: at[lockedAxis] }
  }
  const at = mode === 'add' && floor ? floorTarget(floor.x, floor.z) : null
  return at ? { at, plane: planeFor(lockedAxis, at[lockedAxis]), lockedAxis, lockedValue: at[lockedAxis] } : null
}

export function pickLockedTarget(clientX: number, clientY: number, rect: DOMRect, camera: Camera,
  stroke: StrokeTarget, clampToBounds = false): Coordinate | null {
  setRay(clientX, clientY, rect, camera)
  const point = raycaster.ray.intersectPlane(stroke.plane, intersection)
  if (!point) return null
  const at = {
    x: Math.floor(point.x + EDITOR_SIZE / 2),
    y: Math.floor(point.y),
    z: Math.floor(point.z + EDITOR_SIZE / 2),
  }
  at[stroke.lockedAxis] = stroke.lockedValue
  if (clampToBounds) for (const axis of ['x', 'y', 'z'] as const)
    at[axis] = Math.max(0, Math.min(EDITOR_SIZE - 1, at[axis]))
  return inBounds(at) ? at : null
}

export function rectangleCoordinates(start: Coordinate, end: Coordinate, lockedAxis: Axis): Coordinate[] {
  const axes = (['x', 'y', 'z'] as const).filter(axis => axis !== lockedAxis)
  const cells: Coordinate[] = []
  for (let a = Math.min(start[axes[0]], end[axes[0]]); a <= Math.max(start[axes[0]], end[axes[0]]); a++)
    for (let b = Math.min(start[axes[1]], end[axes[1]]); b <= Math.max(start[axes[1]], end[axes[1]]); b++) {
      const at = { ...start, [axes[0]]: a, [axes[1]]: b }
      if (inBounds(at)) cells.push(at)
    }
  return cells
}

export function rectanglePreview(start: Coordinate, end: Coordinate, lockedAxis: Axis,
  model: VoxelModel, mode: EditMode, color: string): Voxel[] {
  return rectangleCoordinates(start, end, lockedAxis)
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
