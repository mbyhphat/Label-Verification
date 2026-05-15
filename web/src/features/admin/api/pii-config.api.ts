import { supabase } from '@/lib/supabase/client'
import type { ProjectPiiConfigResponse } from '@/types/domain'

export async function getProjectPiiConfig(projectId: string): Promise<ProjectPiiConfigResponse> {
  const { data, error } = await supabase.rpc('get_project_pii_config', {
    p_project_id: projectId,
  })

  if (error) throw error
  return data
}

export async function updateProjectPiiConfig(input: {
  projectId: string
  requiredEntityTypes: string[]
}): Promise<ProjectPiiConfigResponse> {
  const { data, error } = await supabase.rpc('update_project_pii_config', {
    p_project_id: input.projectId,
    p_required_entity_types: input.requiredEntityTypes,
  })

  if (error) throw error
  return data
}
