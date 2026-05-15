import { supabase } from '@/lib/supabase/client'
import type { Dataset } from '@/types/domain'

export async function listDatasets(): Promise<Dataset[]> {
  const { data, error } = await supabase
    .from('datasets')
    .select('*')
    .order('language', { ascending: true })
    .order('folder', { ascending: true })
    .order('source_key', { ascending: true })

  if (error) throw error
  return data
}
