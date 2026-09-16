import { ROOM_DEPTH, ROOM_WIDTH, VOXEL_UNIT } from './config'
import type { RoomInstance, RoomModel, RoomRotation } from './model'

export interface FloorPosition { x: number; z: number; rotation: RoomRotation }
export function rotate90(rotation: RoomRotation): RoomRotation {
  return ((rotation + 90) % 360) as RoomRotation
}
export function snapFloorPoint(worldX: number, worldZ: number) {
  return { x: Math.floor(worldX + ROOM_WIDTH / 2), z: Math.floor(worldZ + ROOM_DEPTH / 2) }
}
// Conservative occupied bounding rectangle, not a per-voxel/physics collision system.
export function placementBounds(model: RoomModel, position: FloorPosition) {
  const width = (model.maxX - model.minX) * VOXEL_UNIT
  const depth = (model.maxZ - model.minZ) * VOXEL_UNIT
  const sideways = position.rotation === 90 || position.rotation === 270
  return { x: position.x, z: position.z,
    maxX: position.x + (sideways ? depth : width), maxZ: position.z + (sideways ? width : depth) }
}
export function validatePlacement(model: RoomModel, position: FloorPosition,
  instances: readonly RoomInstance[], ignoreId?: string): string | null {
  if (!Number.isInteger(position.x) || !Number.isInteger(position.z) || ![0,90,180,270].includes(position.rotation))
    return 'Use integer floor coordinates and 90° rotations.'
  const bounds = placementBounds(model, position)
  if (bounds.x < 0 || bounds.z < 0 || bounds.maxX > ROOM_WIDTH || bounds.maxZ > ROOM_DEPTH)
    return 'Furniture must fit inside the room.'
  for (const instance of instances) {
    if (instance.placement.id === ignoreId) continue
    const other = placementBounds(instance.model, instance.placement)
    if (bounds.x < other.maxX && bounds.maxX > other.x && bounds.z < other.maxZ && bounds.maxZ > other.z)
      return 'Furniture overlaps another placed item.'
  }
  return null
}
