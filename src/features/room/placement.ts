import { coordinateKey, type Coordinate } from '../voxel/model'
import { DEFAULT_ROOM_DIMENSIONS, VOXEL_UNIT, type RoomDimensions } from './config'
import type { RoomInstance, RoomModel, RoomRotation } from './model'

export interface PlacementPosition { x: number; y: number; z: number; rotation: RoomRotation }
export function rotate90(rotation: RoomRotation): RoomRotation {
  return ((rotation + 90) % 360) as RoomRotation
}
export function snapFloorPoint(worldX: number, worldZ: number, dimensions: RoomDimensions = DEFAULT_ROOM_DIMENSIONS) {
  return { x: Math.floor(worldX / VOXEL_UNIT + dimensions.width / 2),
    z: Math.floor(worldZ / VOXEL_UNIT + dimensions.depth / 2) }
}
export function placementBounds(model: RoomModel, position: PlacementPosition) {
  const width = model.maxX - model.minX
  const depth = model.maxZ - model.minZ
  const sideways = position.rotation === 90 || position.rotation === 270
  return { x: position.x, y: position.y, z: position.z,
    maxX: position.x + (sideways ? depth : width), maxY: position.y + model.maxY - model.minY,
    maxZ: position.z + (sideways ? width : depth) }
}
export function worldVoxels(model: RoomModel, position: PlacementPosition): Coordinate[] {
  return model.voxels.map(voxel => {
    const x = voxel.x - model.minX, z = voxel.z - model.minZ
    const width = model.maxX - model.minX, depth = model.maxZ - model.minZ
    const [rotatedX, rotatedZ] = position.rotation === 0 ? [x, z]
      : position.rotation === 90 ? [z, width - 1 - x]
      : position.rotation === 180 ? [width - 1 - x, depth - 1 - z] : [depth - 1 - z, x]
    return { x: position.x + rotatedX, y: position.y + voxel.y - model.minY, z: position.z + rotatedZ }
  })
}
function otherVoxels(instances: readonly RoomInstance[], ignoreId?: string) {
  return new Set(instances.filter(item => item.placement.id !== ignoreId)
    .flatMap(item => worldVoxels(item.model, item.placement)).map(coordinateKey))
}
function placementError(model: RoomModel, position: PlacementPosition, occupied: ReadonlySet<string>, dimensions: RoomDimensions): string | null {
  if (![position.x, position.y, position.z].every(Number.isInteger) || ![0, 90, 180, 270].includes(position.rotation))
    return 'Use integer voxel coordinates and 90° rotations.'
  const bounds = placementBounds(model, position)
  if (bounds.x < 0 || bounds.z < 0 || bounds.y < 0 || bounds.maxX > dimensions.width
    || bounds.maxZ > dimensions.depth || bounds.maxY > dimensions.height)
    return 'Furniture must fit inside the room.'
  const voxels = worldVoxels(model, position)
  if (voxels.some(voxel => occupied.has(coordinateKey(voxel)))) return 'Furniture overlaps another placed item.'
  if (!voxels.some(voxel => voxel.y === 0 || occupied.has(coordinateKey({ ...voxel, y: voxel.y - 1 }))))
    return 'Furniture needs support from the floor or another item.'
  return null
}
export function validatePlacement(model: RoomModel, position: PlacementPosition,
  instances: readonly RoomInstance[], ignoreId?: string, dimensions: RoomDimensions = DEFAULT_ROOM_DIMENSIONS): string | null {
  return placementError(model, position, otherVoxels(instances, ignoreId), dimensions)
}
export function lowestRestingPosition(model: RoomModel, x: number, z: number, rotation: RoomRotation,
  instances: readonly RoomInstance[], ignoreId?: string, dimensions: RoomDimensions = DEFAULT_ROOM_DIMENSIONS): PlacementPosition | null {
  const occupied = otherVoxels(instances, ignoreId)
  for (let y = 0; y <= dimensions.height - (model.maxY - model.minY); y++) {
    const position = { x, y, z, rotation }
    if (!placementError(model, position, occupied, dimensions)) return position
  }
  return null
}

export function validateRoomResize(instances: readonly RoomInstance[], dimensions: RoomDimensions): string | null {
  if (instances.some(item => worldVoxels(item.model, item.placement).some(voxel =>
    voxel.x < 0 || voxel.x >= dimensions.width || voxel.y < 0 || voxel.y >= dimensions.height ||
    voxel.z < 0 || voxel.z >= dimensions.depth))) return 'Existing furniture would be outside the resized room.'
  return null
}
