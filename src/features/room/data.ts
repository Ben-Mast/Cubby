import { supabase } from '../../lib/supabase/client'
import { fetchCurrentHome, type SharedHome } from '../home/currentHome'
import { getFurnitureDefinitions, listFurnitureForHome, type FurnitureSummary } from '../furniture/data'
import { reconstructRoomModel, roomTransform, type PlacedFurniture, type RoomInstance, type RoomModel } from './model'
import { validatePlacement, validateRoomResize, type PlacementPosition } from './placement'
import { validRoomDimensions, type RoomDimensions } from './config'
import { getSurfaceDefinitions } from '../surfaces/data'
import { pixelsFromData, type SurfaceDesign } from '../surfaces/model'

export interface SharedRoomData { home: SharedHome; instances: RoomInstance[]; furniture: FurnitureSummary[];
  floorSurface: SurfaceDesign | null; wallSurface: SurfaceDesign | null; warnings: string[] }
export async function fetchSharedRoom(): Promise<SharedRoomData> {
  const home = await fetchCurrentHome()
  return fetchSharedRoomForHome(home)
}
export async function fetchSharedRoomForHome(home: SharedHome): Promise<SharedRoomData> {
  const [{ data, error }, furniture, surfaces] = await Promise.all([
    supabase.from('placed_furniture').select('id, home_id, furniture_id, x, y, z, rotation, updated_at').eq('home_id', home.id).order('id'),
    listFurnitureForHome(home.id),
    getSurfaceDefinitions(home.id, [home.floor_surface_id, home.wall_surface_id].filter((id): id is string => Boolean(id))),
  ])
  if (error) throw new Error('Unable to load your shared room. Check your connection and retry.')
  const placements = (data ?? []) as PlacedFurniture[]
  const definitions = await getFurnitureDefinitions(home.id, placements.map(item => item.furniture_id))
  const models = new Map<string, RoomModel>()
  const warnings: string[] = []
  function appliedSurface(id: string | null, type: 'floor' | 'wall'): SurfaceDesign | null {
    if (!id) return null
    const surface = surfaces.find(item => item.id === id && item.type === type)
    try { if (surface) pixelsFromData(surface.pixel_data, surface.width, surface.height) }
    catch { warnings.push(`The applied ${type} surface is invalid.`); return null }
    if (!surface) warnings.push(`The applied ${type} surface is unavailable.`)
    return surface ?? null
  }
  const floorSurface = appliedSurface(home.floor_surface_id, 'floor')
  const wallSurface = appliedSurface(home.wall_surface_id, 'wall')
  for (const definition of definitions) {
    try { models.set(definition.id, reconstructRoomModel(definition.voxel_data)) }
    catch { warnings.push(`“${definition.name}” has invalid voxel data and could not be rendered.`) }
  }
  const instances: RoomInstance[] = []
  let missing = false
  for (const placement of placements) {
    const model = models.get(placement.furniture_id)
    if (!model) { missing = true; continue }
    try { roomTransform(placement, model, home); instances.push({ placement, model, name: definitions.find(item => item.id === placement.furniture_id)?.name }) }
    catch { warnings.push('A placed item has invalid position/rotation data and could not be rendered.') }
  }
  if (missing) warnings.push('Some placed designs are unavailable. Refresh the room to load the latest data.')
  return { home, instances, furniture, floorSurface, wallSurface, warnings }
}

async function checkedPlacement(furnitureId: string, position: PlacementPosition, placementId?: string) {
  const room = await fetchSharedRoom()
  if (room.warnings.length) throw new Error('Refresh or repair unavailable room items before placing furniture.')
  if (placementId && !room.instances.some(item => item.placement.id === placementId && item.placement.furniture_id === furnitureId))
    throw new Error('This placed item no longer exists. Refresh the room.')
  const [definition] = await getFurnitureDefinitions(room.home.id, [furnitureId])
  if (!definition) throw new Error('This furniture no longer exists or is not accessible.')
  const invalid = validatePlacement(reconstructRoomModel(definition.voxel_data), position, room.instances, placementId, room.home)
  if (invalid) throw new Error(invalid)
  return room.home.id
}
const placementColumns = 'id, home_id, furniture_id, x, y, z, rotation, updated_at'
function placementWriteError(error: { code?: string; message?: string } | null, fallback: string): Error {
  if (error?.code === '23514' && (error.message === 'Furniture must fit inside the room.' || error.message === 'Furniture overlaps another placed item.'
    || error.message === 'Furniture needs support from the floor or another item.'))
    return new Error(error.message)
  return new Error(fallback)
}
export async function createPlacement(furnitureId: string, position: PlacementPosition): Promise<PlacedFurniture> {
  const homeId = await checkedPlacement(furnitureId, position)
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user || authError) throw new Error('Sign in before placing furniture.')
  const { data, error } = await supabase.from('placed_furniture')
    .insert({ home_id: homeId, furniture_id: furnitureId, created_by: user.id,
      x: position.x, y: position.y, z: position.z, rotation: position.rotation })
    .select(placementColumns).single<PlacedFurniture>()
  if (error || !data) throw placementWriteError(error, 'Unable to confirm placement. Refresh the room before retrying.')
  return data
}
export async function updatePlacement(id: string, furnitureId: string, position: PlacementPosition): Promise<PlacedFurniture> {
  const homeId = await checkedPlacement(furnitureId, position, id)
  const { data, error } = await supabase.from('placed_furniture')
    .update({ x: position.x, y: position.y, z: position.z, rotation: position.rotation })
    .eq('home_id', homeId).eq('id', id).select(placementColumns).single<PlacedFurniture>()
  if (error || !data) throw placementWriteError(error, 'Unable to update placement. Refresh the room and retry.')
  return data
}
export async function removePlacement(id: string): Promise<void> {
  const home = await fetchCurrentHome()
  const { data, error } = await supabase.from('placed_furniture').delete()
    .eq('home_id', home.id).eq('id', id).select('id').single<{ id: string }>()
  if (error || !data) throw new Error('Unable to remove placement. Refresh the room and retry.')
}
export async function updateRoomDimensions(dimensions: RoomDimensions): Promise<SharedHome> {
  if (!validRoomDimensions(dimensions)) throw new Error('Room dimensions must be whole voxels within the allowed range.')
  const room = await fetchSharedRoom()
  if (room.warnings.length) throw new Error('Some room items could not be loaded. Refresh before resizing.')
  const invalid = validateRoomResize(room.instances, dimensions)
  if (invalid) throw new Error(invalid)
  const { data, error } = await supabase.from('homes').update(dimensions).eq('id', room.home.id)
    .select('id, name, created_at, width, depth, height, floor_surface_id, wall_surface_id').single<SharedHome>()
  if (error || !data) {
    if (error?.code === '23514' && error.message === 'Existing furniture would be outside the resized room.') throw new Error(error.message)
    throw new Error('Unable to resize the room. Check your connection and retry.')
  }
  return data
}
