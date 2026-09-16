import { VOXEL_UNIT, type RoomDimensions } from './config'

export type RoomWall = 'front' | 'back' | 'left' | 'right'
export interface HiddenWalls { x: 'left' | 'right'; z: 'front' | 'back' }
export const ROOM_WALLS: readonly RoomWall[] = ['front', 'back', 'left', 'right']
export const WALL_THICKNESS = 0.15

// Front is +Z, right is +X. Keep the last side in a narrow angular dead zone
// so a camera orbiting near a cardinal direction does not flicker between walls.
export function hiddenWallsForCamera(x: number, z: number, previous?: HiddenWalls): HiddenWalls {
  const deadZone = Math.hypot(x, z) * 0.025
  return {
    x: x > deadZone ? 'right' : x < -deadZone ? 'left' : previous?.x ?? (x >= 0 ? 'right' : 'left'),
    z: z > deadZone ? 'front' : z < -deadZone ? 'back' : previous?.z ?? (z >= 0 ? 'front' : 'back'),
  }
}

export function roomWallBoxes(dimensions: RoomDimensions): Record<RoomWall, {
  position: [number, number, number]; size: [number, number, number]
}> {
  const width = dimensions.width * VOXEL_UNIT
  const depth = dimensions.depth * VOXEL_UNIT
  const height = dimensions.height * VOXEL_UNIT
  const halfThickness = WALL_THICKNESS / 2
  return {
    front: { position: [0, height / 2, depth / 2 + halfThickness], size: [width, height, WALL_THICKNESS] },
    back: { position: [0, height / 2, -depth / 2 - halfThickness], size: [width, height, WALL_THICKNESS] },
    left: { position: [-width / 2 - halfThickness, height / 2, 0], size: [WALL_THICKNESS, height, depth] },
    right: { position: [width / 2 + halfThickness, height / 2, 0], size: [WALL_THICKNESS, height, depth] },
  }
}

// Walls are scenery, never selectable targets (including while fading away).
export function skipWallRaycast() {}
