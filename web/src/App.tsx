import { LoginPage } from '@/pages/LoginPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { useSession } from '@/hooks/useSession'
import { supabaseConfig } from '@/lib/supabase/client'

function App() {
  const { session, loading, signOut } = useSession()

  if (!supabaseConfig.isConfigured) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-background">
        <div className="max-w-sm w-full px-6 py-8 border border-border rounded-lg space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Configuration required
          </p>
          <h1 className="text-xl font-semibold text-foreground">Connect Supabase</h1>
          <p className="text-sm text-muted-foreground">
            Set{' '}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              VITE_SUPABASE_URL
            </code>{' '}
            and{' '}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              VITE_SUPABASE_PUBLISHABLE_KEY
            </code>{' '}
            in your local env file.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-background">
        <div className="max-w-sm w-full px-6 py-8 border border-border rounded-lg space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Loading
          </p>
          <h1 className="text-xl font-semibold text-foreground">Restoring session</h1>
          <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
            <div className="h-full w-1/2 bg-foreground/20 rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return <LoginPage />
  }

  return <ReviewPage session={session} onSignOut={signOut} />
}

export default App
