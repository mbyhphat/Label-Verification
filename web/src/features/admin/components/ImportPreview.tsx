import { useMemo, useState } from 'react'
import { AlertTriangle, Database, RefreshCw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ExistingDatasetCheck, ImportFolder } from '@/types/domain'

type ImportPreviewProps = {
  folder: ImportFolder
  existing: ExistingDatasetCheck | null
  checkingExisting: boolean
  replace: boolean
  importing: boolean
  onReplaceChange: (replace: boolean) => void
  onImport: () => void
}

export function ImportPreview({
  folder,
  existing,
  checkingExisting,
  replace,
  importing,
  onReplaceChange,
  onImport,
}: ImportPreviewProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const errors = folder.issues.filter((issue) => issue.level === 'error')
  const warnings = folder.issues.filter((issue) => issue.level === 'warning')
  const duplicateEntities = useMemo(() => {
    const existingTypes = new Set(existing?.existingEntityTypes ?? [])
    return folder.entities.filter((entity) => existingTypes.has(entity.entity_type))
  }, [existing, folder.entities])
  const needsReplace = duplicateEntities.length > 0
  const canImport = errors.length === 0 && (!needsReplace || replace)

  function handleImportClick() {
    if (replace) {
      setConfirmOpen(true)
      return
    }
    onImport()
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-4 border-b border-border p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Import preview</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            {folder.sourceKey ?? 'Unresolved source'} · {folder.language ?? 'unknown'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {folder.sampleCount} samples · {folder.entities.length} entity types · folder {folder.folder ?? 'none'}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" />
          {checkingExisting ? 'Checking' : existing?.dataset ? 'Existing dataset' : 'New dataset'}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {(errors.length > 0 || warnings.length > 0 || duplicateEntities.length > 0) && (
          <div className="space-y-2">
            {errors.map((issue) => (
              <IssueLine key={issue.message} tone="error" message={issue.message} />
            ))}
            {warnings.map((issue) => (
              <IssueLine key={issue.message} tone="warning" message={issue.message} />
            ))}
            {duplicateEntities.length > 0 && (
              <IssueLine
                tone="warning"
                message={`Existing review rows found for ${duplicateEntities
                  .map((entity) => entity.entity_type)
                  .join(', ')}.`}
              />
            )}
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity</TableHead>
              <TableHead className="text-right">Audit</TableHead>
              <TableHead className="text-right">Spans</TableHead>
              <TableHead className="text-right">Rows</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {folder.entities.map((entity) => (
              <TableRow key={entity.entity_type}>
                <TableCell className="font-mono text-xs">{entity.entity_type}</TableCell>
                <TableCell className="text-right tabular-nums">{entity.audit_count}</TableCell>
                <TableCell className="text-right tabular-nums">{entity.export_span_count}</TableCell>
                <TableCell className="text-right tabular-nums">{entity.review_item_count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => onReplaceChange(event.target.checked)}
              className="size-4 rounded border-border bg-background accent-primary"
            />
            Replace duplicate entity rows
          </label>

          <Button type="button" onClick={handleImportClick} disabled={!canImport || importing || checkingExisting}>
            {importing ? <RefreshCw className="animate-spin" /> : <Upload />}
            {importing ? 'Importing' : 'Import'}
          </Button>
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-amber-400/10 text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Confirm replace</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Existing review rows for matching entity types will be deleted before import.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setConfirmOpen(false)
                  onImport()
                }}
              >
                Replace
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function IssueLine({ tone, message }: { tone: 'error' | 'warning'; message: string }) {
  return (
    <div
      className={[
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-amber-300/20 bg-amber-300/10 text-amber-200',
      ].join(' ')}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
