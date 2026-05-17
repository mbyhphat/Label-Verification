import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertTriangle, Check, Search, XCircle } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { getProjectPiiConfig } from '@/features/admin/api/pii-config.api'
import { DatasetSidebar } from '@/features/review/components/DatasetSidebar'
import { ExportButton } from '@/features/review/components/ExportButton'
import { ReviewModal } from '@/features/review/components/ReviewModal'
import { ReviewTable } from '@/features/review/components/ReviewTable'
import { useReviewWorkspace } from '@/features/review/hooks/useReviewWorkspace'
import type { PrivacyMaskEntry, ReviewDecision, ReviewItem, ReviewSample } from '@/types/domain'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ReviewPageProps = {
  session: Session
  onSignOut: () => void
  canShowAdmin: boolean
}

const ALL_ENTITY_TYPES = '__all__'

type VerdictFilter = 'ALL' | 'CORRECT' | 'WRONG_LABEL' | 'UNREALISTIC_VALUE'

const VERDICT_PILLS: { value: VerdictFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'CORRECT', label: 'Correct' },
  { value: 'WRONG_LABEL', label: 'Wrong' },
  { value: 'UNREALISTIC_VALUE', label: 'Unrealistic' },
]

const projectLabelCache = new Map<string, string[]>()
const projectLabelRequests = new Map<string, Promise<string[]>>()

async function loadCachedProjectLabels(projectId: string, forceRefresh = false): Promise<string[]> {
  if (!forceRefresh) {
    const cached = projectLabelCache.get(projectId)
    if (cached) return cached

    const pending = projectLabelRequests.get(projectId)
    if (pending) return pending
  }

  const request = getProjectPiiConfig(projectId)
    .then((config) => {
      const labels = config.required_entity_types
      projectLabelCache.set(projectId, labels)
      return labels
    })
    .catch(() => {
      projectLabelCache.set(projectId, [])
      return []
    })

  projectLabelRequests.set(projectId, request)
  void request.finally(() => {
    if (projectLabelRequests.get(projectId) === request) {
      projectLabelRequests.delete(projectId)
    }
  })

  return request
}

export function ReviewPage({ session, onSignOut, canShowAdmin }: ReviewPageProps) {
  const {
    datasets,
    activeDataset,
    entityTypes,
    activeEntityType,
    items,
    samplesById,
    activeItem,
    activeSample,
    loadingDatasets,
    loadingItems,
    acquiringLock,
    saving,
    notice,
    stats,
    selectDataset,
    selectEntityType,
    openItem,
    submitDecision,
    saveSampleMask,
    releaseLock,
  } = useReviewWorkspace(session)

  // ── Local UI state ─────────────────────────────────────────────
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [modalItemId, setModalItemId] = useState<string | null>(null)
  const [configuredEntityTypes, setConfiguredEntityTypes] = useState<{
    projectId: string
    labels: string[]
  } | null>(null)
  const activeProjectId = activeDataset?.project_id ?? null

  const loadProjectLabels = useCallback(async (projectId: string, forceRefresh = false) => {
    const labels = await loadCachedProjectLabels(projectId, forceRefresh)
    setConfiguredEntityTypes((current) =>
      current?.projectId === projectId && current.labels === labels
        ? current
        : { projectId, labels },
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    const projectId = activeProjectId

    async function loadCurrentProjectLabels(projectId: string) {
      const labels = await loadCachedProjectLabels(projectId)
      if (!cancelled) {
        setConfiguredEntityTypes({
          projectId,
          labels,
        })
      }
    }

    if (projectId) void loadCurrentProjectLabels(projectId)

    return () => {
      cancelled = true
    }
  }, [activeProjectId])

  // ── Derived state ──────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    let result = items
    if (verdictFilter !== 'ALL') {
      result = result.filter((i) => i.verdict === verdictFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (i) =>
          i.value.toLowerCase().includes(q) ||
          (i.reason?.toLowerCase().includes(q) ?? false) ||
          (i.suggested_label?.toLowerCase().includes(q) ?? false) ||
          i.entity_type.toLowerCase().includes(q) ||
          i.sample_key.toLowerCase().includes(q),
      )
    }
    return result
  }, [items, verdictFilter, searchQuery])

  const verdictCounts = useMemo(
    () => ({
      total: items.length,
      correct: items.filter((i) => i.verdict === 'CORRECT').length,
      wrong: items.filter((i) => i.verdict === 'WRONG_LABEL').length,
      unrealistic: items.filter((i) => i.verdict === 'UNREALISTIC_VALUE').length,
    }),
    [items],
  )

  const modalItemIndex = useMemo(
    () => (modalItemId ? filteredItems.findIndex((i) => i.id === modalItemId) : -1),
    [modalItemId, filteredItems],
  )

  const projectLabelOptions = useMemo(() => {
    return configuredEntityTypes && configuredEntityTypes.projectId === activeProjectId
      ? configuredEntityTypes.labels
      : []
  }, [activeProjectId, configuredEntityTypes])

  const labelOptions = useMemo(() => {
    const seen = new Set<string>()
    const labels: string[] = []
    const addLabel = (label: string | null | undefined) => {
      if (!label || seen.has(label)) return
      seen.add(label)
      labels.push(label)
    }

    for (const label of projectLabelOptions) addLabel(label)
    for (const label of entityTypes) addLabel(label)
    for (const entry of activeSample?.current_privacy_mask ?? []) {
      addLabel(entry.label)
    }

    return labels
  }, [
    activeSample?.current_privacy_mask,
    entityTypes,
    projectLabelOptions,
  ])

  // ── Navigation helper ──────────────────────────────────────────
  const navigateToItem = useCallback(
    async (item: ReviewItem) => {
      setModalItemId(item.id)
      await Promise.all([
        openItem(item),
        activeProjectId ? loadProjectLabels(activeProjectId) : Promise.resolve(),
      ])
    },
    [activeProjectId, loadProjectLabels, openItem],
  )

  const handleOpenItem = useCallback(
    (item: ReviewItem) => {
      void navigateToItem(item)
    },
    [navigateToItem],
  )

  const handleCloseModal = useCallback(() => {
    setModalItemId(null)
    if (activeSample) {
      void releaseLock(activeSample.id)
    }
  }, [activeSample, releaseLock])

  const handleModalPrev = useCallback(() => {
    if (modalItemIndex > 0 && !acquiringLock) {
      void navigateToItem(filteredItems[modalItemIndex - 1])
    }
  }, [modalItemIndex, filteredItems, acquiringLock, navigateToItem])

  const handleModalNext = useCallback(() => {
    if (modalItemIndex < filteredItems.length - 1 && !acquiringLock) {
      void navigateToItem(filteredItems[modalItemIndex + 1])
    }
  }, [modalItemIndex, filteredItems, acquiringLock, navigateToItem])

  const handleModalSubmit = useCallback(
    async (
      item: ReviewItem,
      sample: ReviewSample,
      decision: ReviewDecision,
      reviewerNote: string,
    ) => {
      // Capture next item BEFORE submission reloads the list
      const currentIdx = filteredItems.findIndex((i) => i.id === item.id)
      const nextItem =
        currentIdx >= 0 && currentIdx + 1 < filteredItems.length
          ? filteredItems[currentIdx + 1]
          : null

      await submitDecision(item, sample, decision, reviewerNote, projectLabelOptions)

      if (nextItem) {
        await navigateToItem(nextItem)
      } else {
        setModalItemId(null)
      }
    },
    [filteredItems, projectLabelOptions, submitDecision, navigateToItem],
  )

  const handleModalSaveSampleMask = useCallback(
    async (
      item: ReviewItem,
      sample: ReviewSample,
      sourceText: string,
      privacyMask: PrivacyMaskEntry[],
    ) => {
      await saveSampleMask(item, sample, sourceText, privacyMask)
    },
    [saveSampleMask],
  )

  const headerStats =
    !loadingItems && items.length > 0 ? (
      <div
        className="hidden items-center gap-2 overflow-hidden text-[12px] sm:flex"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <span style={{ color: '#2e3345' }}>│</span>
        <span style={{ color: '#60a5fa' }}>{verdictCounts.total} total</span>
        <span style={{ color: '#2e3345' }}>·</span>
        <span className="inline-flex items-center gap-1" style={{ color: '#34d399' }}>
          <Check aria-hidden="true" className="h-3 w-3" />
          {verdictCounts.correct}
        </span>
        <span style={{ color: '#2e3345' }}>·</span>
        <span className="inline-flex items-center gap-1" style={{ color: '#f87171' }}>
          <XCircle aria-hidden="true" className="h-3 w-3" />
          {verdictCounts.wrong}
        </span>
        <span style={{ color: '#2e3345' }}>·</span>
        <span className="inline-flex items-center gap-1" style={{ color: '#fbbf24' }}>
          <AlertTriangle aria-hidden="true" className="h-3 w-3" />
          {verdictCounts.unrealistic}
        </span>
        <span style={{ color: '#2e3345' }}>·</span>
        <span style={{ color: '#9ca3b8' }}>
          {stats.completed}/{stats.total} reviewed
        </span>
      </div>
    ) : null

  // ── Render ────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col h-svh"
      style={{ background: '#0f1117', color: '#e4e6ed' }}
    >
      <AppHeader
        canShowAdmin={canShowAdmin}
        onSignOut={onSignOut}
        stats={headerStats}
        actions={<ExportButton dataset={activeDataset} />}
      />

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Dataset sidebar */}
        <DatasetSidebar
          datasets={datasets}
          activeDatasetId={activeDataset?.id ?? null}
          loading={loadingDatasets}
          onSelectDataset={selectDataset}
        />

        {/* Main content */}
        <section className="flex flex-col flex-1 overflow-hidden min-w-0">
          {/* ── Toolbar ── */}
          <div
            className="px-5 py-3 shrink-0 flex flex-col gap-2.5"
            style={{ background: '#1a1d27', borderBottom: '1px solid #2e3345' }}
          >
            {/* Dataset name + entity type selector */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="text-[10px] font-semibold uppercase tracking-widest mb-0.5"
                  style={{ color: '#9ca3b8' }}
                >
                  Active dataset
                </p>
                <h2 className="text-[13px] font-semibold truncate" style={{ color: '#e4e6ed' }}>
                  {activeDataset
                    ? `${activeDataset.source_key} · ${activeDataset.language}`
                    : 'No dataset selected'}
                </h2>
              </div>
              <Select
                value={activeEntityType ?? ALL_ENTITY_TYPES}
                onValueChange={(v) => selectEntityType(v === ALL_ENTITY_TYPES ? null : v)}
              >
                <SelectTrigger size="sm" className="w-44 text-xs shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ENTITY_TYPES}>All classes</SelectItem>
                  {entityTypes.map((et) => (
                    <SelectItem key={et} value={et}>
                      {et}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Verdict filter pills + search + result count */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Pills */}
              <div className="flex">
                {VERDICT_PILLS.map((pill, idx) => {
                  const isActive = verdictFilter === pill.value
                  return (
                    <button
                      key={pill.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setVerdictFilter(pill.value)}
                      className="cursor-pointer select-none px-3 py-1 text-[12px] transition-[background-color,border-color,color] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                      style={{
                        border: '1px solid',
                        borderColor: isActive ? '#60a5fa' : '#2e3345',
                        borderLeft:
                          idx > 0
                            ? `1px solid ${isActive ? '#60a5fa' : '#2e3345'}`
                            : undefined,
                        marginLeft: idx > 0 ? '-1px' : 0,
                        borderRadius:
                          idx === 0
                            ? '5px 0 0 5px'
                            : idx === VERDICT_PILLS.length - 1
                              ? '0 5px 5px 0'
                              : '0',
                        position: 'relative',
                        zIndex: isActive ? 1 : 0,
                        background: isActive ? 'rgba(96,165,250,0.12)' : '#1a1d27',
                        color: isActive ? '#60a5fa' : '#9ca3b8',
                      }}
                    >
                      {pill.label}
                    </button>
                  )
                })}
              </div>

              {/* Search */}
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9ca3b8]"
                />
                <input
                  type="search"
                  name="review-search"
                  aria-label="Search review items"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search value, reason, label…"
                  className="rounded-md py-1 pl-8 pr-3 text-[12px] transition-[border-color,background-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                  style={{
                    background: '#11141c',
                    border: '1px solid #2e3345',
                    color: '#e4e6ed',
                    width: '240px',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#60a5fa')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2e3345')}
                />
              </div>

              {/* Result count */}
              <span className="ml-auto text-[12px]" style={{ color: '#9ca3b8' }}>
                {filteredItems.length} / {items.length}
              </span>
            </div>
          </div>

          {/* ── Notice banner ── */}
          {notice && (
            <div
              className="px-5 py-2 text-xs shrink-0"
              style={{
                background: 'rgba(251,191,36,0.08)',
                borderBottom: '1px solid #2e3345',
                color: '#fbbf24',
              }}
              role="status"
              aria-live="polite"
            >
              {notice}
            </div>
          )}

          {/* ── Table or loader ── */}
          {loadingItems ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm" style={{ color: '#9ca3b8' }}>
                Loading review items…
              </p>
            </div>
          ) : (
            <ReviewTable
              items={filteredItems}
              samplesById={samplesById}
              activeItemId={activeItem?.id ?? null}
              currentUserId={session.user.id}
              onOpenItem={handleOpenItem}
            />
          )}
        </section>
      </div>

      {/* ── Detail modal ── */}
      {modalItemId !== null && (
        <ReviewModal
          item={activeItem}
          sample={activeSample}
          currentIndex={modalItemIndex}
          totalCount={filteredItems.length}
          saving={saving}
          acquiringLock={acquiringLock}
          currentUserId={session.user.id}
          labelOptions={labelOptions}
          onPrev={handleModalPrev}
          onNext={handleModalNext}
          onClose={handleCloseModal}
          onSubmit={handleModalSubmit}
          onSaveSampleMask={handleModalSaveSampleMask}
        />
      )}
    </div>
  )
}
