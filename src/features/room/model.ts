import { deserializeModel, type Voxel, type VoxelData } from '../voxel/model'
import { ROOM_DEPTH, ROOM_WIDTH, VOXEL_UNIT } from './config'

export type RoomRotation = 0 | 90 | 180 | 270
export interface PlacedFurniture {
  id: string; home_id: string; furniture_id: string; x: number; z: number; rotation: RoomRotation
}
export interface RoomModel {
  voxels: readonly Voxel[]
  minX: number; minY: number; minZ: number; maxX: number; maxZ: number
}
export interface RoomInstance { placement: PlacedFurniture; model: RoomModel; name?: string }

export function reconstructRoomModel(data: VoxelData): RoomModel {
  const voxels = [...deserializeModel(JSON.stringify(data)).values()]
  if (!voxels.length) throw new Error('A placed design has no voxels.')
  return {
    voxels,
    minX: Math.min(...voxels.map(voxel => voxel.x)), minY: Math.min(...voxels.map(voxel => voxel.y)),
    minZ: Math.min(...voxels.map(voxel => voxel.z)),
    maxX: Math.max(...voxels.map(voxel => voxel.x)) + 1,
    maxZ: Math.max(...voxels.map(voxel => voxel.z)) + 1,
  }
}

export function roomTransform(placement: PlacedFurniture, model: RoomModel) {
  if (!Number.isInteger(placement.x) || !Number.isInteger(placement.z) || ![0, 90, 180, 270].includes(placement.rotation))
    throw new Error('Invalid placed furniture coordinates or rotation.')
  // Positive Three.js Y rotation maps (x,z) to (z,-x) at 90 degrees.
  // Normalize the rotated cube bounds to the minimum footprint corner.
  const [minX, minZ] = placement.rotation === 0 ? [model.minX, model.minZ]
    : placement.rotation === 90 ? [model.minZ, -model.maxX]
    : placement.rotation === 180 ? [-model.maxX, -model.maxZ] : [-model.maxZ, model.minX]
  return {
    position: [-ROOM_WIDTH / 2 + placement.x - minX * VOXEL_UNIT,
      -model.minY * VOXEL_UNIT, -ROOM_DEPTH / 2 + placement.z - minZ * VOXEL_UNIT] as [number, number, number],
    rotation: placement.rotation * Math.PI / 180,
    scale: VOXEL_UNIT,
  }
}
