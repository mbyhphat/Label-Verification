import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { formatSupabaseError } from '@/lib/supabase/errors'
import type { LabelingProject, ProjectMember } from '@/types/domain'

type UseProjectMembershipsState = {
  projects: LabelingProject[]
  memberships: ProjectMember[]
  loading: boolean
  error: string
  adminProjectIds: Set<string>
  hasAdminAccess: boolean
  reload: () => Promise<void>
}

export function useProjectMemberships(session: Session | null): UseProjectMembershipsState {
  const [projects, setProjects] = useState<LabelingProject[]>([])
  const [memberships, setMemberships] = useState<ProjectMember[]>([])
  const [loading, setLoading] = useState(Boolean(session))
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!session) {
      setProjects([])
      setMemberships([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const [{ data: projectRows, error: projectError }, { data: memberRows, error: memberError }] =
        await Promise.all([
          supabase
            .from('labeling_projects')
            .select('*')
            .is('archived_at', null)
            .order('name', { ascending: true }),
          supabase.from('project_members').select('*').eq('user_id', session.user.id),
        ])

      if (projectError) throw projectError
      if (memberError) throw memberError

      setProjects(projectRows)
      setMemberships(memberRows)
    } catch (err) {
      setError(formatSupabaseError(err))
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    void reload()
  }, [reload])

  const adminProjectIds = useMemo(
    () =>
      new Set(
        memberships
          .filter((membership) => membership.role === 'owner' || membership.role === 'admin')
          .map((membership) => membership.project_id),
      ),
    [memberships],
  )

  return {
    projects,
    memberships,
    loading,
    error,
    adminProjectIds,
    hasAdminAccess: adminProjectIds.size > 0,
    reload,
  }
}
