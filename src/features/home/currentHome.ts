import { supabase } from '../../lib/supabase/client'

export interface SharedHome {
  id: string
  name: string
  created_at: string
}

export async function fetchCurrentHome(): Promise<SharedHome> {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in to load your shared home.')

  const { data: membership, error: membershipError } = await supabase
    .from('home_members').select('home_id').eq('user_id', user.id)
    .maybeSingle<{ home_id: string }>()
  if (membershipError) throw new Error('Unable to resolve your home membership. Check the database setup.')
  if (!membership) throw new Error('No shared home is assigned to this account. Ask the developer to run the setup SQL.')

  const { data: home, error: homeError } = await supabase
    .from('homes').select('id, name, created_at').eq('id', membership.home_id)
    .single<SharedHome>()
  if (homeError || !home) throw new Error('Unable to load your shared home. Check your connection and database setup.')
  return home
}
