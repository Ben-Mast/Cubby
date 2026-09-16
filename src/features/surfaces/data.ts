import { supabase } from '../../lib/supabase/client'
import { fetchCurrentHome } from '../home/currentHome'
import { pixelsFromData, validateSurface, type SurfaceDesign, type SurfaceType } from './model'

const columns = 'id, home_id, creator_id, name, type, pixel_data, width, height, created_at, updated_at'
const libraryColumns = `${columns}, creator:profiles!surfaces_creator_id_fkey(display_name)`

export async function listSurfacesForHome(homeId: string): Promise<SurfaceDesign[]> {
  const { data, error } = await supabase.from('surfaces').select(libraryColumns)
    .eq('home_id', homeId).order('created_at', { ascending: false }).order('id')
  if (error) throw new Error('Unable to load shared surfaces. Check your connection and retry.')
  return (data ?? []) as unknown as SurfaceDesign[]
}
export async function getSurface(id: string): Promise<SurfaceDesign> {
  const home = await fetchCurrentHome()
  const { data, error } = await supabase.from('surfaces').select(columns)
    .eq('home_id', home.id).eq('id', id).maybeSingle<SurfaceDesign>()
  if (error) throw new Error('Unable to load this surface. Check your connection and retry.')
  if (!data) throw new Error('This surface no longer exists or is not accessible.')
  pixelsFromData(data.pixel_data, data.width, data.height)
  return data
}
export async function getSurfaceDefinitions(homeId: string, ids: readonly string[]): Promise<SurfaceDesign[]> {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const { data, error } = await supabase.from('surfaces').select(columns)
    .eq('home_id', homeId).in('id', unique)
  if (error) throw new Error('Unable to load room surfaces. Check your connection and retry.')
  return (data ?? []) as SurfaceDesign[]
}
export async function createSurface(name: string, type: SurfaceType, width: number, height: number, pixels: readonly string[]): Promise<SurfaceDesign> {
  const values = validateSurface(name, type, width, height, pixels)
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in before saving a surface.')
  const home = await fetchCurrentHome()
  const { data, error } = await supabase.from('surfaces').insert({ ...values, home_id: home.id, creator_id: user.id })
    .select(columns).single<SurfaceDesign>()
  if (error || !data) throw new Error('Unable to confirm the surface save. Check the library before retrying.')
  return data
}
export async function updateSurface(id: string, name: string, type: SurfaceType, width: number, height: number, pixels: readonly string[]): Promise<SurfaceDesign> {
  const { type: _type, ...values } = validateSurface(name, type, width, height, pixels)
  const home = await fetchCurrentHome()
  const { data, error } = await supabase.from('surfaces').update(values)
    .eq('home_id', home.id).eq('id', id).eq('type', type).select(columns).single<SurfaceDesign>()
  if (error || !data) throw new Error('Unable to save surface edits. Check your connection and retry.')
  return data
}
export async function deleteSurface(id: string): Promise<void> {
  const home = await fetchCurrentHome()
  const { data, error } = await supabase.from('surfaces').delete()
    .eq('home_id', home.id).eq('id', id).select('id').single<{ id: string }>()
  if (error || !data) throw new Error('Unable to delete this surface. Refresh and retry.')
}
export async function applySurface(id: string | null, type: SurfaceType): Promise<void> {
  const home = await fetchCurrentHome()
  if (id) {
    const design = await getSurface(id)
    if (design.type !== type) throw new Error(`Choose a ${type} surface.`)
  }
  const column = type === 'floor' ? 'floor_surface_id' : 'wall_surface_id'
  const { data, error } = await supabase.from('homes').update({ [column]: id }).eq('id', home.id)
    .select('id').single<{ id: string }>()
  if (error || !data) throw new Error('Unable to apply the surface. Check your connection and retry.')
}
