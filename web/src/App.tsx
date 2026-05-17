import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from '@/pages/LoginPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { useProjectMemberships } from '@/hooks/useProjectMemberships'
import { useSession } from '@/hooks/useSession'
import { supabaseConfig } from '@/lib/supabase/client'

const AdminPage = lazy(() =>
  import('@/pages/AdminPage').then((m) => ({ default: m.AdminPage })),
)

function App() {
  const { session, loading, signOut } = useSession()
  const memberships = useProjectMemberships(session)

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
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route
          path="/"
          element={
            <ReviewPage
              session={session}
              onSignOut={signOut}
              canShowAdmin={memberships.hasAdminAccess}
            />
          }
        />
        <Route
          path="/admin"
          element={
            memberships.loading ? (
              <LoadingCard eyebrow="Loading" title="Checking access" />
            ) : memberships.hasAdminAccess ? (
              <Suspense fallback={<LoadingCard eyebrow="Loading" title="Opening admin" />}>
                <AdminPage
                  projects={memberships.projects}
                  adminProjectIds={memberships.adminProjectIds}
                  membershipsLoading={memberships.loading}
                  membershipError={memberships.error}
                  onMembershipsChanged={memberships.reload}
                  onSignOut={signOut}
                />
              </Suspense>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function LoadingCard({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-border px-6 py-8">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-foreground/20" />
        </div>
      </div>
    </div>
  )
}

export default App
