import { Plane, Raycaster, Vector2, Vector3, type Camera, type InstancedMesh } from 'three'
import { EDITOR_SIZE, inBounds, type Coordinate, type EditMode, type Voxel } from './model'

export function faceTarget(voxel: Coordinate, normal: Coordinate, mode: EditMode): Coordinate | null {
  const at = mode === 'add' ? { x: voxel.x + normal.x, y: voxel.y + normal.y, z: voxel.z + normal.z }
    : { x: voxel.x, y: voxel.y, z: voxel.z }
  return inBounds(at) ? at : null
}
export function floorTarget(x: number, z: number): Coordinate | null {
  const at = { x: Math.floor(x + EDITOR_SIZE / 2), y: 0, z: Math.floor(z + EDITOR_SIZE / 2) }
  return inBounds(at) ? at : null
}
export function pickTarget(clientX: number, clientY: number, rect: DOMRect, camera: Camera,
  mesh: InstancedMesh, voxels: readonly Voxel[], mode: EditMode): Coordinate | null {
  const raycaster = new Raycaster()
  raycaster.setFromCamera(new Vector2((clientX - rect.left) / rect.width * 2 - 1,
    -(clientY - rect.top) / rect.height * 2 + 1), camera)
  const hit = raycaster.intersectObject(mesh)[0]
  const floor = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())
  if (hit && (!floor || hit.distance <= floor.distanceTo(raycaster.ray.origin))) {
    const voxel = hit.instanceId === undefined ? undefined : voxels[hit.instanceId]
    return voxel && hit.face ? faceTarget(voxel, hit.face.normal, mode) : null
  }
  return mode === 'add' && floor ? floorTarget(floor.x, floor.z) : null
}

// Only deliberate single-pointer taps edit; drags/multi-touch/cancellation never do.
export class EditGesture {
  private pointers = new Set<number>()
  private tap: { id: number; x: number; y: number } | null = null
  down(id: number, x: number, y: number, button: number) {
    this.pointers.add(id)
    this.tap = this.pointers.size === 1 && button === 0 ? { id, x, y } : null
  }
  move(id: number, x: number, y: number) {
    if (this.tap?.id === id && Math.hypot(x - this.tap.x, y - this.tap.y) > 6) this.tap = null
  }
  up(id: number, x: number, y: number): boolean {
    this.move(id, x, y)
    const edit = this.tap?.id === id && this.pointers.size === 1
    this.pointers.delete(id)
    this.tap = null
    return edit
  }
  cancel(id: number) { this.pointers.delete(id); this.tap = null }
}
