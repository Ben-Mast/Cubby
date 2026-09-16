export const VOXEL_UNIT = 0.25
export interface RoomDimensions { width: number; depth: number; height: number }
export const DEFAULT_ROOM_DIMENSIONS: RoomDimensions = { width: 64, depth: 64, height: 16 }
export const MAX_ROOM_DIMENSIONS: RoomDimensions = { width: 128, depth: 128, height: 64 }
export const validRoomDimensions = (dimensions: RoomDimensions) =>
  (['width', 'depth', 'height'] as const).every(axis => Number.isInteger(dimensions[axis]) &&
    dimensions[axis] >= 1 && dimensions[axis] <= MAX_ROOM_DIMENSIONS[axis])
