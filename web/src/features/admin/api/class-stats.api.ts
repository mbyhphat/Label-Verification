import { supabase } from '@/lib/supabase/client'
import type { ProjectClassStatistic } from '@/types/domain'

export async function listProjectClassStatistics(projectId: string): Promise<ProjectClassStatistic[]> {
  const { data, error } = await supabase.rpc('list_project_class_statistics', {
    p_project_id: projectId,
  })

  if (error) throw error
  return data ?? []
}
