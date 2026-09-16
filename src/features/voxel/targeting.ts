import { Plane, Raycaster, Vector2, Vector3, type Camera, type InstancedMesh } from 'three'
import { EDITOR_SIZE, inBounds, type Coordinate, type EditMode, type Voxel } from './model'

type Axis = 'x' | 'y' | 'z'
export interface StrokeTarget { at: Coordinate; plane: Plane; lockedAxis: Axis; lockedValue: number }
const raycaster = new Raycaster()
const pointer = new Vector2()
const intersection = new Vector3()
const floorPlane = new Plane(new Vector3(0, 1, 0), 0)

export function faceTarget(voxel: Coordinate, normal: Coordinate, mode: EditMode): Coordinate | null {
  const at = mode === 'add' ? { x: voxel.x + normal.x, y: voxel.y + normal.y, z: voxel.z + normal.z }
    : { x: voxel.x, y: voxel.y, z: voxel.z }
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

function axisForNormal(normal: Vector3): Axis {
  const values = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)]
  return values[0] >= values[1] && values[0] >= values[2] ? 'x' : values[1] >= values[2] ? 'y' : 'z'
}

function planeFor(axis: Axis, value: number) {
  const normal = axis === 'x' ? new Vector3(1, 0, 0) : axis === 'y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
  const worldValue = axis === 'y' ? value : value - EDITOR_SIZE / 2 + 0.5
  return new Plane(normal, -worldValue)
}

export function pickStrokeStart(clientX: number, clientY: number, rect: DOMRect, camera: Camera,
  mesh: InstancedMesh, voxels: readonly Voxel[], mode: EditMode): StrokeTarget | null {
  setRay(clientX, clientY, rect, camera)
  const hit = raycaster.intersectObject(mesh)[0]
  const floor = raycaster.ray.intersectPlane(floorPlane, intersection)
  if (hit && (!floor || hit.distance <= floor.distanceTo(raycaster.ray.origin))) {
    const voxel = hit.instanceId === undefined ? undefined : voxels[hit.instanceId]
    if (!voxel || !hit.face) return null
    const at = faceTarget(voxel, hit.face.normal, mode)
    if (!at) return null
    const lockedAxis = axisForNormal(hit.face.normal)
    return { at, plane: planeFor(lockedAxis, at[lockedAxis]), lockedAxis, lockedValue: at[lockedAxis] }
  }
  const at = mode === 'add' && floor ? floorTarget(floor.x, floor.z) : null
  return at ? { at, plane: planeFor('y', 0), lockedAxis: 'y', lockedValue: 0 } : null
}

export function pickLockedTarget(clientX: number, clientY: number, rect: DOMRect, camera: Camera,
  stroke: StrokeTarget): Coordinate | null {
  setRay(clientX, clientY, rect, camera)
  const point = raycaster.ray.intersectPlane(stroke.plane, intersection)
  if (!point) return null
  const at = {
    x: Math.floor(point.x + EDITOR_SIZE / 2),
    y: Math.floor(point.y),
    z: Math.floor(point.z + EDITOR_SIZE / 2),
  }
  at[stroke.lockedAxis] = stroke.lockedValue
  return inBounds(at) ? at : null
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
