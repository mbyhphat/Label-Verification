import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BarChart3, RefreshCw } from 'lucide-react'
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
import type { ProjectClassStatistic } from '@/types/domain'
import { listProjectClassStatistics } from '../api/class-stats.api'

type ProjectClassStatsPanelProps = {
  projectId: string
  refreshKey: number
}

type SortKey = keyof Pick<
  ProjectClassStatistic,
  'entity_type' | 'item_count' | 'pending_count' | 'completed_count' | 'skipped_count' | 'dataset_count'
>

type SortDirection = 'asc' | 'desc'

type SortState = {
  key: SortKey
  direction: SortDirection
}

export function ProjectClassStatsPanel({ projectId, refreshKey }: ProjectClassStatsPanelProps) {
  const [rows, setRows] = useState<ProjectClassStatistic[]>([])
  const [sort, setSort] = useState<SortState>({ key: 'item_count', direction: 'desc' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadStatistics() {
    if (!projectId) return

    setLoading(true)
    setError('')
    try {
      setRows(await listProjectClassStatistics(projectId))
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
        const nextRows = await listProjectClassStatistics(projectId)
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
          itemCount: total.itemCount + row.item_count,
          classCount: total.classCount + (row.item_count > 0 ? 1 : 0),
          pendingCount: total.pendingCount + row.pending_count,
          completedCount: total.completedCount + row.completed_count,
          skippedCount: total.skippedCount + row.skipped_count,
        }),
        {
          itemCount: 0,
          classCount: 0,
          pendingCount: 0,
          completedCount: 0,
          skippedCount: 0,
        },
      ),
    [rows],
  )

  const sortedRows = useMemo(() => {
    return [...rows].sort((first, second) => compareRows(first, second, sort))
  }, [rows, sort])

  function changeSort(key: SortKey) {
    setSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        }
      }

      return {
        key,
        direction: key === 'entity_type' ? 'asc' : 'desc',
      }
    })
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Project class totals
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-base font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 text-primary" />
            {formatNumber(totals.itemCount)} items across {totals.classCount}/{rows.length} classes
          </h2>
        </div>

        <Button type="button" variant="outline" onClick={loadStatistics} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      <div className="p-4">
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <StatisticSummary label="Pending" value={totals.pendingCount} />
          <StatisticSummary label="Completed" value={totals.completedCount} />
          <StatisticSummary label="Skipped" value={totals.skippedCount} />
        </div>

        <div className="max-h-96 overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead
                  label="Class"
                  sortKey="entity_type"
                  activeSort={sort}
                  onSort={changeSort}
                />
                <SortableHead
                  label="Items"
                  sortKey="item_count"
                  activeSort={sort}
                  onSort={changeSort}
                  align="right"
                />
                <SortableHead
                  label="Pending"
                  sortKey="pending_count"
                  activeSort={sort}
                  onSort={changeSort}
                  align="right"
                />
                <SortableHead
                  label="Completed"
                  sortKey="completed_count"
                  activeSort={sort}
                  onSort={changeSort}
                  align="right"
                />
                <SortableHead
                  label="Skipped"
                  sortKey="skipped_count"
                  activeSort={sort}
                  onSort={changeSort}
                  align="right"
                />
                <SortableHead
                  label="Datasets"
                  sortKey="dataset_count"
                  activeSort={sort}
                  onSort={changeSort}
                  align="right"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Loading class statistics
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No classes configured
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row) => (
                  <TableRow key={row.entity_type}>
                    <TableCell className="font-mono text-xs">{row.entity_type}</TableCell>
                    <NumberCell value={row.item_count} strong />
                    <NumberCell value={row.pending_count} />
                    <NumberCell value={row.completed_count} />
                    <NumberCell value={row.skipped_count} />
                    <NumberCell value={row.dataset_count} />
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

function SortableHead({
  label,
  sortKey,
  activeSort,
  onSort,
  align = 'left',
}: {
  label: string
  sortKey: SortKey
  activeSort: SortState
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = activeSort.key === sortKey
  const Icon = activeSort.direction === 'asc' ? ArrowUp : ArrowDown

  return (
    <TableHead className={align === 'right' ? 'text-right' : ''}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={[
          'inline-flex h-8 items-center gap-1 rounded px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          align === 'right' ? 'justify-end' : '',
          active ? 'text-foreground' : '',
        ].join(' ')}
      >
        <span>{label}</span>
        {active && <Icon className="h-3.5 w-3.5" />}
      </button>
    </TableHead>
  )
}

function StatisticSummary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background/30 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{formatNumber(value)}</p>
    </div>
  )
}

function NumberCell({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <TableCell
      className={[
        'text-right tabular-nums',
        strong ? 'font-semibold text-foreground' : value === 0 ? 'text-muted-foreground' : '',
      ].join(' ')}
    >
      {formatNumber(value)}
    </TableCell>
  )
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function compareRows(
  first: ProjectClassStatistic,
  second: ProjectClassStatistic,
  sort: SortState,
): number {
  const direction = sort.direction === 'asc' ? 1 : -1

  if (sort.key === 'entity_type') {
    const result = first.entity_type.localeCompare(second.entity_type)
    return result === 0 ? 0 : result * direction
  }

  const firstValue = first[sort.key]
  const secondValue = second[sort.key]
  if (firstValue !== secondValue) return (firstValue - secondValue) * direction

  return first.entity_type.localeCompare(second.entity_type)
}
