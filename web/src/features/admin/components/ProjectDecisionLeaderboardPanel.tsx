import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatSupabaseError } from '@/lib/supabase/errors'
import type { ProjectDecisionLeaderboardRow, ProjectRole } from '@/types/domain'
import { listProjectDecisionLeaderboard } from '../api/decision-leaderboard.api'

type ProjectDecisionLeaderboardPanelProps = {
  projectId: string
  refreshKey: number
}

const roleLabels: Record<ProjectRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
}

export function ProjectDecisionLeaderboardPanel({
  projectId,
  refreshKey,
}: ProjectDecisionLeaderboardPanelProps) {
  const [rows, setRows] = useState<ProjectDecisionLeaderboardRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadLeaderboard() {
    if (!projectId) return

    setLoading(true)
    setError('')
    try {
      setRows(await listProjectDecisionLeaderboard(projectId))
    } catch (err) {
      setError(formatSupabaseError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function runLoad() {
      if (!projectId) return

      setLoading(true)
      setError('')
      try {
        const nextRows = await listProjectDecisionLeaderboard(projectId)
        if (!cancelled) setRows(nextRows)
      } catch (err) {
        if (!cancelled) setError(formatSupabaseError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void runLoad()
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  const totals = useMemo(
    () =>
      rows.reduce(
        (total, row) => ({
          accountCount: total.accountCount + 1,
          activeAccountCount: total.activeAccountCount + (row.decide_count > 0 ? 1 : 0),
          decideCount: total.decideCount + row.decide_count,
        }),
        {
          accountCount: 0,
          activeAccountCount: 0,
          decideCount: 0,
        },
      ),
    [rows],
  )

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Decision leaderboard
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-base font-semibold text-foreground">
            <Trophy className="h-4 w-4 text-primary" />
            {formatNumber(totals.decideCount)} decisions by {totals.activeAccountCount}/
            {totals.accountCount} accounts
          </h2>
        </div>

        <Button type="button" variant="outline" onClick={loadLeaderboard} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      <div className="p-4">
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <div className="max-h-80 overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-right">Rank</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Decisions</TableHead>
                <TableHead className="text-right">Last decided</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    Loading leaderboard
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No reviewer accounts
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow key={row.user_id}>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <AccountCell row={row} />
                    </TableCell>
                    <TableCell>
                      <RoleCell role={row.role} />
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground">
                      {formatNumber(row.decide_count)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                      {formatDateTime(row.last_decided_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  )
}

function AccountCell({ row }: { row: ProjectDecisionLeaderboardRow }) {
  if (row.email) {
    return <span className="font-medium text-foreground">{row.email}</span>
  }

  return (
    <div className="flex min-w-0 flex-col">
      <span className="font-mono text-xs text-muted-foreground">{shortUserId(row.user_id)}</span>
      <span className="text-xs text-muted-foreground">unknown email</span>
    </div>
  )
}

function RoleCell({ role }: { role: ProjectRole | null }) {
  return (
    <span className="inline-flex rounded border border-border bg-background/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {role ? roleLabels[role] : 'Former member'}
    </span>
  )
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Never'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function shortUserId(userId: string): string {
  if (userId.length <= 12) return userId
  return `${userId.slice(0, 8)}...${userId.slice(-4)}`
}
