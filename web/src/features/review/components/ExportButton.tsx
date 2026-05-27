import { useState } from 'react'
import { DownloadIcon, FileClockIcon } from 'lucide-react'
import { formatSupabaseError } from '@/lib/supabase/errors'
import type { Dataset } from '@/types/domain'
import { exportReviewAudit, exportReviewedDataset } from '../api/review.api'
import { Button } from '@/components/ui/button'

type ExportButtonProps = {
  dataset: Dataset | null
}

type ExportAction = 'dataset' | 'audit'

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
}

function buildExportFilename(dataset: Dataset, suffix: string) {
  return [
    safeFilenamePart(dataset.source_key),
    dataset.language,
    dataset.folder || 'dataset',
    suffix,
  ].join('_') + '.json'
}

export function ExportButton({ dataset }: ExportButtonProps) {
  const [loading, setLoading] = useState<ExportAction | null>(null)
  const [error, setError] = useState('')

  async function handleExportDataset() {
    if (!dataset) return

    setLoading('dataset')
    setError('')
    try {
      const payload = await exportReviewedDataset(dataset)
      downloadJson(buildExportFilename(dataset, 'reviewed'), payload)
    } catch (caught) {
      setError(formatSupabaseError(caught))
    } finally {
      setLoading(null)
    }
  }

  async function handleExportAudit() {
    if (!dataset) return

    setLoading('audit')
    setError('')
    try {
      const payload = await exportReviewAudit(dataset)
      downloadJson(buildExportFilename(dataset, 'audit'), payload)
    } catch (caught) {
      setError(formatSupabaseError(caught))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={!dataset || loading !== null}
          onClick={handleExportDataset}
          type="button"
        >
          <DownloadIcon aria-hidden="true" />
          {loading === 'dataset' ? 'Exporting…' : 'Export JSON'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dataset || loading !== null}
          onClick={handleExportAudit}
          type="button"
        >
          <FileClockIcon aria-hidden="true" />
          {loading === 'audit' ? 'Exporting…' : 'Audit'}
        </Button>
      </div>
      {error ? (
        <span className="text-[11px] text-destructive max-w-40 text-right">{error}</span>
      ) : null}
    </div>
  )
}
