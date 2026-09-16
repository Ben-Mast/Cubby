import { supabase } from '../../lib/supabase/client'
import { fetchCurrentHome } from '../home/currentHome'
import { deserializeModel, serializeModel, type VoxelData, type VoxelModel } from '../voxel/model'

export interface FurnitureSummary {
  id: string; home_id: string; creator_id: string; name: string; created_at: string; updated_at: string
  creator: { display_name: string } | null
}
export interface FurnitureRecord {
  id: string; home_id: string; creator_id: string; name: string; voxel_data: VoxelData
  created_at: string; updated_at: string
}
const recordColumns = 'id, home_id, creator_id, name, voxel_data, created_at, updated_at'
// Used by room reads after resolving the authenticated home. RLS still applies.
export async function getFurnitureDefinitions(homeId: string, ids: readonly string[]): Promise<FurnitureRecord[]> {
  const uniqueIds = [...new Set(ids)]
  if (!uniqueIds.length) return []
  const { data, error } = await supabase.from('furniture').select(recordColumns)
    .eq('home_id', homeId).in('id', uniqueIds)
  if (error) throw new Error('Unable to load room furniture designs. Check your connection and retry.')
  return (data ?? []) as FurnitureRecord[]
}
export function validateFurniture(name: string, model: VoxelModel) {
  if (!name.trim()) throw new Error('Enter a furniture name.')
  if (!model.size) throw new Error('Add at least one voxel before saving.')
  return { name: name.trim(), voxel_data: JSON.parse(serializeModel(model)) as VoxelData }
}
export async function listFurniture(): Promise<FurnitureSummary[]> {
  const home = await fetchCurrentHome()
  return listFurnitureForHome(home.id)
}
export async function listFurnitureForHome(homeId: string): Promise<FurnitureSummary[]> {
  const { data, error } = await supabase.from('furniture')
    .select('id, home_id, creator_id, name, created_at, updated_at, creator:profiles!furniture_creator_id_fkey(display_name)')
    .eq('home_id', homeId).order('created_at', { ascending: false }).order('id')
  if (error) throw new Error('Unable to load furniture. Check your connection and try again.')
  return (data ?? []) as unknown as FurnitureSummary[]
}
export async function getFurniture(id: string): Promise<FurnitureRecord> {
  const home = await fetchCurrentHome()
  const { data, error } = await supabase.from('furniture').select(recordColumns)
    .eq('home_id', home.id).eq('id', id).maybeSingle<FurnitureRecord>()
  if (error) throw new Error('Unable to load furniture. Check your connection and try again.')
  if (!data) throw new Error('This furniture no longer exists or is not accessible.')
  deserializeModel(JSON.stringify(data.voxel_data))
  return data
}
export async function createFurniture(name: string, model: VoxelModel): Promise<FurnitureRecord> {
  const values = validateFurniture(name, model)
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in before saving furniture.')
  const home = await fetchCurrentHome()
  const { data, error } = await supabase.from('furniture')
    .insert({ ...values, home_id: home.id, creator_id: user.id }).select(recordColumns).single<FurnitureRecord>()
  if (error || !data) throw new Error('Unable to confirm the save. Check your connection and the library before retrying.')
  return data
}
export async function updateFurniture(id: string, name: string, model: VoxelModel): Promise<FurnitureRecord> {
  const values = validateFurniture(name, model)
  const home = await fetchCurrentHome()
  // Ownership/home stay unchanged; the existing trigger owns updated_at.
  const { data, error } = await supabase.from('furniture').update(values)
    .eq('home_id', home.id).eq('id', id).select(recordColumns).single<FurnitureRecord>()
  if (error || !data) throw new Error('Unable to save edits. Check your connection; the furniture may have been deleted.')
  return data
}
async function placementCount(homeId: string, id: string): Promise<number> {
  const { count, error } = await supabase.from('placed_furniture').select('id', { count: 'exact', head: true })
    .eq('home_id', homeId).eq('furniture_id', id)
  if (error || count === null) throw new Error('Unable to check placed copies. Deletion has not started.')
  return count
}
export async function countPlacedInstances(id: string): Promise<number> {
  return placementCount((await fetchCurrentHome()).id, id)
}
export class PlacementCountChangedError extends Error {
  constructor(public count: number) { super('The placed-copy count changed. Review the updated warning and confirm again.') }
}
export async function deleteFurniture(id: string, confirmedCount: number): Promise<void> {
  const home = await fetchCurrentHome()
  if (confirmedCount < 0 || !Number.isInteger(confirmedCount)) throw new Error('Confirm the placed-copy count before deleting.')
  const count = await placementCount(home.id, id)
  if (count !== confirmedCount) throw new PlacementCountChangedError(count)
  const { data, error } = await supabase.from('furniture').delete()
    .eq('home_id', home.id).eq('id', id).select('id').single<{ id: string }>()
  if (error || !data) throw new Error('Unable to delete furniture. Refresh the library and try again.')
}
