import type { ChangeEvent, DragEvent } from 'react'
import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FolderOpen, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImportFolder } from '@/types/domain'
import { parseFolderUpload } from '../utils/folder-parser'

type FolderUploadZoneProps = {
  folder: ImportFolder | null
  onFolderParsed: (folder: ImportFolder) => void
}

const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as Record<string, string>

export function FolderUploadZone({ folder, onFolderParsed }: FolderUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [parsing, setParsing] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  async function parseFiles(files: FileList | File[]) {
    if (files.length === 0) return
    setParsing(true)
    try {
      const nextFolder = await parseFolderUpload(files)
      onFolderParsed(nextFolder)
    } finally {
      setParsing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void parseFiles(event.target.files)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    void parseFiles(event.dataTransfer.files)
  }

  const hasErrors = folder?.issues.some((issue) => issue.level === 'error') ?? false

  return (
    <section className="rounded-lg border border-border bg-card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={[
          'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center transition-colors',
          dragActive ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60 hover:bg-muted/40',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
          {...directoryInputProps}
        />
        <div className="flex size-12 items-center justify-center rounded-lg bg-muted text-primary">
          {parsing ? <Loader2 className="h-5 w-5 animate-spin" /> : <FolderOpen className="h-5 w-5" />}
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            {parsing ? 'Reading folder' : 'Select import folder'}
          </h2>
          <p className="text-sm text-muted-foreground">
            manifest.json, samples.json, and entities/*/audit.json + export.json
          </p>
        </div>
        <Button type="button" variant="outline" size="sm">
          <FolderOpen aria-hidden="true" />
          Choose folder
        </Button>
      </div>

      {folder && (
        <div className="border-t border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{folder.rootName}</p>
              <p className="text-xs text-muted-foreground">
                {folder.files.length} JSON files · {folder.sampleCount} samples · {folder.entities.length} entities
              </p>
            </div>
            <span
              className={[
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
                hasErrors ? 'bg-destructive/10 text-destructive' : 'bg-emerald-400/10 text-emerald-300',
              ].join(' ')}
            >
              {hasErrors ? <AlertCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {hasErrors ? 'Blocked' : 'Ready'}
            </span>
          </div>

          <div className="max-h-44 overflow-auto rounded-md border border-border bg-background/40">
            {folder.files.map((file) => (
              <div
                key={file.path}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-0"
              >
                <span className="truncate font-mono text-muted-foreground">{file.path}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
