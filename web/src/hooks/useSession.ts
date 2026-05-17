import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, getStoredSession } from '@/lib/supabase/client'

export function useSession() {
  // Lazy initialisers: read localStorage once on mount — not on every render.
  // Returning users skip the loading screen until getSession confirms below.
  const [session, setSession] = useState<Session | null>(() => getStoredSession())
  const [loading, setLoading] = useState(() => session === null)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession)
        setLoading(false)
      },
    )

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  return {
    session,
    loading,
    signOut: () => supabase.auth.signOut(),
  }
}
