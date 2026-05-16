import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { ImportProgressUpdate } from '../api/import.api'
import type { ImportResult } from '@/types/domain'

type ImportProgressProps = {
  result: ImportResult | null
  error: string
  progress?: ImportProgressUpdate | null
}

export function ImportProgress({ result, error, progress }: ImportProgressProps) {
  if (!result && !error && !progress) return null

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      {error ? (
        <div className="flex items-start gap-3 text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold">Import failed</h2>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        </div>
      ) : progress ? (
        <div className="flex items-start gap-3 text-primary">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold">Importing</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {progress.phase === 'samples'
                ? 'Uploading samples'
                : `Uploading ${progress.entityType ?? 'entity'} (${progress.completed}/${progress.total})`}
            </p>
          </div>
        </div>
      ) : (
        result && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="text-base font-semibold">Import complete</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Dataset {result.dataset_created ? 'created' : 'updated'} · {result.sample_count} samples
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {result.entities.map((entity) => (
                <div key={entity.entity_type} className="rounded-md border border-border bg-background/40 p-3">
                  <p className="font-mono text-xs font-medium text-foreground">{entity.entity_type}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entity.inserted_review_items}/{entity.payload_review_items} rows inserted
                    {entity.deleted_review_items > 0 ? ` · ${entity.deleted_review_items} replaced` : ''}
                  </p>
                </div>
              ))}
            </div>

            {result.warnings.length > 0 && (
              <div className="rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-200">
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </section>
  )
}
