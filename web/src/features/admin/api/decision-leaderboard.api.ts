import { supabase } from '@/lib/supabase/client'
import type { ProjectDecisionLeaderboardRow } from '@/types/domain'

export async function listProjectDecisionLeaderboard(
  projectId: string,
): Promise<ProjectDecisionLeaderboardRow[]> {
  const { data, error } = await supabase.rpc('list_project_decision_leaderboard', {
    p_project_id: projectId,
  })

  if (error) throw error
  return data ?? []
}
