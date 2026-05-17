import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  CheckSquare,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatSupabaseError } from '@/lib/supabase/errors'
import type { ProjectPiiConfigResponse } from '@/types/domain'
import { getProjectPiiConfig, updateProjectPiiConfig } from '../api/pii-config.api'

type ProjectPiiConfigPanelProps = {
  projectId: string
  onConfigChanged?: () => void
}

export function ProjectPiiConfigPanel({ projectId, onConfigChanged }: ProjectPiiConfigPanelProps) {
  const [config, setConfig] = useState<ProjectPiiConfigResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [newClassName, setNewClassName] = useState('')
  const [editingClass, setEditingClass] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      if (!projectId) return

      setLoading(true)
      setNotice('')
      setError('')
      try {
        const nextConfig = await getProjectPiiConfig(projectId)
        if (cancelled) return
        setConfig(nextConfig)
        setSelected(new Set(nextConfig.required_entity_types))
      } catch (err) {
        if (!cancelled) setError(formatSupabaseError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const catalog = useMemo(() => {
    const known = new Map((config?.catalog ?? []).map((entity) => [entity.entity_type, entity]))
    let nextSortOrder = 100000
    for (const entityType of selected) {
      if (!known.has(entityType)) {
        known.set(entityType, { entity_type: entityType, sort_order: nextSortOrder })
        nextSortOrder += 1
      }
    }
    return [...known.values()].sort((a, b) => a.sort_order - b.sort_order || a.entity_type.localeCompare(b.entity_type))
  }, [config?.catalog, selected])

  const filteredCatalog = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return catalog
    return catalog.filter((entity) => entity.entity_type.toLowerCase().includes(normalizedQuery))
  }, [catalog, query])

  const isDirty = useMemo(() => {
    const required = new Set(config?.required_entity_types ?? [])
    if (required.size !== selected.size) return true
    return [...selected].some((entityType) => !required.has(entityType))
  }, [config?.required_entity_types, selected])

  function toggleEntity(entityType: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(entityType)) {
        next.delete(entityType)
      } else {
        next.add(entityType)
      }
      return next
    })
    setNotice('')
  }

  function selectAll() {
    setSelected(new Set(catalog.map((entity) => entity.entity_type)))
    setNotice('')
  }

  function addClass() {
    const normalized = normalizeEntityTypeName(newClassName)
    if (!normalized) return
    if (!isValidEntityTypeName(normalized)) {
      setError('Class name can only contain A-Z, 0-9, and underscore.')
      return
    }
    setSelected((current) => new Set(current).add(normalized))
    setNewClassName('')
    setNotice('')
    setError('')
  }

  function beginEdit(entityType: string) {
    setEditingClass(entityType)
    setEditingValue(entityType)
    setNotice('')
    setError('')
  }

  function applyEdit() {
    if (!editingClass) return
    const normalized = normalizeEntityTypeName(editingValue)
    if (!normalized) return
    if (!isValidEntityTypeName(normalized)) {
      setError('Class name can only contain A-Z, 0-9, and underscore.')
      return
    }

    setSelected((current) => {
      const next = new Set(current)
      next.delete(editingClass)
      next.add(normalized)
      return next
    })
    setEditingClass(null)
    setEditingValue('')
    setNotice('')
    setError('')
  }

  async function saveConfig() {
    if (!config || selected.size === 0) return

    setSaving(true)
    setNotice('')
    setError('')
    try {
      const order = new Map(catalog.map((entity) => [entity.entity_type, entity.sort_order]))
      const requiredEntityTypes = [...selected].sort(
        (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
      )
      const nextConfig = await updateProjectPiiConfig({
        projectId,
        requiredEntityTypes,
      })
      setConfig(nextConfig)
      setSelected(new Set(nextConfig.required_entity_types))
      setNotice('Saved PII class requirements.')
      onConfigChanged?.()
    } catch (err) {
      setError(formatSupabaseError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Required PII classes
          </p>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            {selected.size}/{catalog.length} selected
          </h2>
          {config?.updated_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              Updated {new Date(config.updated_at).toLocaleString()}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter classes"
              className="w-full pl-8 sm:w-52"
            />
          </div>
          <Button type="button" variant="outline" onClick={selectAll} disabled={loading || !config}>
            <CheckSquare />
            Select all
          </Button>
          <Button
            type="button"
            onClick={saveConfig}
            disabled={loading || saving || selected.size === 0 || !isDirty}
          >
            {saving ? <RefreshCw className="animate-spin" /> : <Save />}
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && (
          <p className="inline-flex items-center gap-1.5 rounded-md bg-emerald-400/10 px-2 py-1 text-sm text-emerald-300">
            <Check className="h-3.5 w-3.5" />
            {notice}
          </p>
        )}

        <div className="flex flex-col gap-2 rounded-md border border-border bg-background/30 p-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Add class
            </p>
            <Input
              value={newClassName}
              onChange={(event) => setNewClassName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addClass()
                }
              }}
              placeholder="NEW_CLASS_NAME"
            />
          </div>
          <Button type="button" variant="outline" onClick={addClass} disabled={!newClassName.trim()}>
            <Plus />
            Add
          </Button>
        </div>

        <div className="grid max-h-80 gap-2 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading class catalog
            </div>
          ) : (
            filteredCatalog.map((entity) => {
              const checked = selected.has(entity.entity_type)
              return (
                <div
                  key={entity.entity_type}
                  className={[
                    'flex h-10 items-center gap-1 rounded-md border px-2 text-left text-xs font-medium transition-colors',
                    checked
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border bg-background/30 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => toggleEntity(entity.entity_type)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left"
                  >
                    {checked ? (
                      <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate font-mono">{entity.entity_type}</span>
                  </button>
                  {checked && (
                    <button
                      type="button"
                      onClick={() => beginEdit(entity.entity_type)}
                      className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Edit ${entity.entity_type}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        {selected.size === 0 && (
          <p className="text-sm text-destructive">Select at least one required PII class.</p>
        )}
      </div>

      {editingClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Edit class
                </p>
                <h3 className="mt-1 text-base font-semibold text-foreground">{editingClass}</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingClass(null)
                  setEditingValue('')
                }}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <Input
              value={editingValue}
              onChange={(event) => setEditingValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyEdit()
                }
              }}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingClass(null)
                  setEditingValue('')
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={applyEdit} disabled={!editingValue.trim()}>
                <Save />
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function normalizeEntityTypeName(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}

function isValidEntityTypeName(value: string): boolean {
  return /^[A-Z0-9_]+$/.test(value)
}
