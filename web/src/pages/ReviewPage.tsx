import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Hash, RefreshCw, Search, XCircle } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { Button } from '@/components/ui/button'
import { getProjectPiiConfig } from '@/features/admin/api/pii-config.api'
import { openSample } from '@/features/review/api/review.api'
import { DatasetSidebar } from '@/features/review/components/DatasetSidebar'
import { ExportButton } from '@/features/review/components/ExportButton'
import { ReviewModal } from '@/features/review/components/ReviewModal'
import { ReviewTable } from '@/features/review/components/ReviewTable'
import { useReviewWorkspace } from '@/features/review/hooks/useReviewWorkspace'
import type { PrivacyMaskEntry, ReviewBundle, ReviewDecision, ReviewItem, ReviewSample } from '@/types/domain'
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

const REVIEW_VIEW_MODES = [
  { value: 'review', label: 'To review' },
  { value: 'labeled', label: 'Labeled' },
] as const

const projectLabelCache = new Map<string, string[]>()
const projectLabelRequests = new Map<string, Promise<string[]>>()

function isActionableReviewItem(item: ReviewItem, submittedItemIds: Set<string>): boolean {
  return item.status === 'pending' && item.decision == null && !submittedItemIds.has(item.id)
}

function findNextActionableItem(
  items: ReviewItem[],
  currentItemId: string,
  submittedItemIds: Set<string>,
): ReviewItem | null {
  const currentIdx = items.findIndex((item) => item.id === currentItemId)
  const orderedCandidates =
    currentIdx === -1 ? items : [...items.slice(currentIdx + 1), ...items.slice(0, currentIdx)]

  return (
    orderedCandidates.find(
      (item) => item.id !== currentItemId && isActionableReviewItem(item, submittedItemIds),
    ) ?? null
  )
}

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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, value])

  return debouncedValue
}

export function ReviewPage({ session, onSignOut, canShowAdmin }: ReviewPageProps) {
  // ── Local UI state ─────────────────────────────────────────────
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [sampleIdSearch, setSampleIdSearch] = useState('')
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 350)
  const debouncedSampleIdSearch = useDebouncedValue(sampleIdSearch, 350)
  const activeVerdictFilter = verdictFilter === 'ALL' ? null : verdictFilter
  const [modalItemId, setModalItemId] = useState<string | null>(null)

  const {
    datasets,
    activeDataset,
    entityTypes,
    activeEntityType,
    items,
    samplesById,
    activeItem,
    activeSample,
    activeItemReadOnly,
    viewMode,
    loadingDatasets,
    loadingItems,
    acquiringLock,
    saving,
    notice,
    stats,
    pageInfo,
    syncing,
    lastSyncedAt,
    countsStatus,
    selectDataset,
    selectEntityType,
    selectViewMode,
    loadNextPage,
    loadPreviousPage,
    refreshCurrentPage,
    openItem,
    submitDecision,
    saveSampleMask,
    releaseLock,
  } = useReviewWorkspace(session, {
    verdict: activeVerdictFilter,
    search: debouncedSearchQuery,
    sampleIdSearch: debouncedSampleIdSearch,
    pagePollingPaused: modalItemId !== null,
  })
  const filteredItemsRef = useRef<ReviewItem[]>([])
  const submittedItemIdsRef = useRef<Set<string>>(new Set())
  const decisionInFlightItemIdRef = useRef<string | null>(null)
  const [submittingItemId, setSubmittingItemId] = useState<string | null>(null)
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
  const filteredItems = items

  useEffect(() => {
    filteredItemsRef.current = filteredItems
  }, [filteredItems])

  useEffect(() => {
    submittedItemIdsRef.current = new Set()
  }, [activeDataset?.id, activeEntityType, debouncedSampleIdSearch, debouncedSearchQuery, verdictFilter, viewMode])

  const verdictCounts = useMemo(
    () => ({
      total: stats.total,
      correct: stats.correct,
      wrong: stats.wrong_label,
      unrealistic: stats.unrealistic_value,
    }),
    [stats.correct, stats.total, stats.unrealistic_value, stats.wrong_label],
  )

  const modalItemIndex = useMemo(
    () => (modalItemId ? filteredItems.findIndex((i) => i.id === modalItemId) : -1),
    [modalItemId, filteredItems],
  )

  const resultCountLabel = pageInfo.filteredTotal === null
    ? viewMode === 'labeled'
      ? `${filteredItems.length} labeled loaded · Page ${pageInfo.pageIndex}`
      : `${filteredItems.length} loaded · Page ${pageInfo.pageIndex}`
    : viewMode === 'labeled'
      ? `${filteredItems.length} of ${pageInfo.filteredTotal} labeled · Page ${pageInfo.pageIndex}`
      : `${filteredItems.length} of ${pageInfo.filteredTotal} · Page ${pageInfo.pageIndex}`

  const syncStatusLabel = syncing
    ? 'Refreshing...'
    : countsStatus === 'error'
      ? 'Count unavailable'
      : lastSyncedAt
        ? 'Updated just now'
        : ''

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
    async (
      item: ReviewItem,
      prefetchedBundle?: ReviewBundle,
      forceAcquireLock = false,
    ) => {
      setModalItemId(item.id)
      await Promise.all([
        openItem(item, prefetchedBundle, {
          forceAcquireLock,
          readOnly: viewMode === 'labeled',
        }),
        activeProjectId ? loadProjectLabels(activeProjectId) : Promise.resolve(),
      ])
    },
    [activeProjectId, loadProjectLabels, openItem, viewMode],
  )

  const handleOpenItem = useCallback(
    (item: ReviewItem) => {
      void navigateToItem(item)
    },
    [navigateToItem],
  )

  const handleCloseModal = useCallback(() => {
    if (decisionInFlightItemIdRef.current !== null) return

    setModalItemId(null)
    if (activeSample && !activeItemReadOnly) {
      void releaseLock(activeSample.id)
    }
  }, [activeItemReadOnly, activeSample, releaseLock])

  const handleModalPrev = useCallback(() => {
    if (modalItemIndex > 0 && !acquiringLock && submittingItemId === null) {
      void navigateToItem(filteredItems[modalItemIndex - 1])
    }
  }, [modalItemIndex, filteredItems, acquiringLock, submittingItemId, navigateToItem])

  const handleModalNext = useCallback(() => {
    if (acquiringLock || submittingItemId !== null) return

    if (modalItemIndex < filteredItems.length - 1) {
      void navigateToItem(filteredItems[modalItemIndex + 1])
      return
    }

    if (pageInfo.hasMore) {
      void loadNextPage().then((nextPageItems) => {
        const nextItem =
          nextPageItems.find((candidate) =>
            isActionableReviewItem(candidate, submittedItemIdsRef.current),
          ) ?? nextPageItems[0] ?? null
        if (nextItem) void navigateToItem(nextItem)
      })
    }
  }, [
    acquiringLock,
    filteredItems,
    loadNextPage,
    modalItemIndex,
    navigateToItem,
    pageInfo.hasMore,
    submittingItemId,
  ])

  const handleNextPage = useCallback(() => {
    setModalItemId(null)
    if (activeSample && !activeItemReadOnly) void releaseLock(activeSample.id)
    void loadNextPage()
  }, [activeItemReadOnly, activeSample, loadNextPage, releaseLock])

  const handlePreviousPage = useCallback(() => {
    setModalItemId(null)
    if (activeSample && !activeItemReadOnly) void releaseLock(activeSample.id)
    void loadPreviousPage()
  }, [activeItemReadOnly, activeSample, loadPreviousPage, releaseLock])

  const handleRefreshPage = useCallback(() => {
    void refreshCurrentPage()
  }, [refreshCurrentPage])

  const handleSelectViewMode = useCallback(
    (mode: (typeof REVIEW_VIEW_MODES)[number]['value']) => {
      setModalItemId(null)
      selectViewMode(mode)
    },
    [selectViewMode],
  )

  const handleModalSubmit = useCallback(
    async (
      item: ReviewItem,
      sample: ReviewSample,
      decision: ReviewDecision,
      reviewerNote: string,
    ) => {
      if (decisionInFlightItemIdRef.current !== null || viewMode === 'labeled') {
        return
      }

      decisionInFlightItemIdRef.current = item.id
      setSubmittingItemId(item.id)

      try {
        // Pre-compute for opportunistic prefetching before the network round-trip.
        // Next item after submit uses the authoritative re-computation below — not this value.
        const precomputedNext = findNextActionableItem(
          filteredItemsRef.current,
          item.id,
          submittedItemIdsRef.current,
        )
        const canPrefetchNext = precomputedNext !== null && precomputedNext.sample_row_id !== sample.id
        const prefetchedBundlePromise = canPrefetchNext
          ? openSample(precomputedNext.sample_row_id, 120).catch(() => null)
          : Promise.resolve<ReviewBundle | null>(null)

        const submitted = await submitDecision(
          item,
          sample,
          decision,
          reviewerNote,
          projectLabelOptions,
        )

        if (!submitted) {
          void prefetchedBundlePromise.then((bundle) => {
            if (bundle) void releaseLock(bundle.sample.id).catch(() => {})
          })
          return
        }

        submittedItemIdsRef.current = new Set(submittedItemIdsRef.current).add(item.id)

        // Re-compute after submit: local patch (upsertReviewItem) + submittedItemIdsRef
        // must both be reflected before auto-advance.
        const nextItem = findNextActionableItem(
          filteredItemsRef.current,
          item.id,
          submittedItemIdsRef.current,
        )

        if (nextItem) {
          // Reuse the prefetch only when it targeted the same sample we're navigating
          // to; otherwise release that lock and let openItem acquire a fresh one.
          const prefetchMatchesSample = precomputedNext?.sample_row_id === nextItem.sample_row_id
          let prefetchedBundle: ReviewBundle | null = null
          if (prefetchMatchesSample) {
            prefetchedBundle = await prefetchedBundlePromise
          } else {
            void prefetchedBundlePromise.then((bundle) => {
              if (bundle) void releaseLock(bundle.sample.id).catch(() => {})
            })
          }
          await navigateToItem(
            nextItem,
            prefetchedBundle ?? undefined,
            nextItem.sample_row_id === sample.id,
          )
        } else {
          void prefetchedBundlePromise.then((bundle) => {
            if (bundle) void releaseLock(bundle.sample.id).catch(() => {})
          })

          if (pageInfo.hasMore) {
            const nextPageItems = await loadNextPage()
            const nextPageItem =
              nextPageItems.find((candidate) =>
                isActionableReviewItem(candidate, submittedItemIdsRef.current),
              ) ?? null

            if (nextPageItem) {
              await navigateToItem(nextPageItem)
              return
            }
          }

          setModalItemId(null)
        }
      } finally {
        if (decisionInFlightItemIdRef.current === item.id) {
          decisionInFlightItemIdRef.current = null
          setSubmittingItemId(null)
        }
      }
    },
    [loadNextPage, navigateToItem, pageInfo.hasMore, projectLabelOptions, releaseLock, submitDecision, viewMode],
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
    !loadingItems && items.length > 0 && pageInfo.filteredTotal !== null ? (
      <div
        className="hidden items-center gap-2.5 overflow-hidden text-[13px] sm:flex"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <span style={{ color: '#343b50' }}>│</span>
        <span style={{ color: '#60a5fa' }}>{verdictCounts.total} total</span>
        <span style={{ color: '#343b50' }}>·</span>
        <span className="inline-flex items-center gap-1" style={{ color: '#34d399' }}>
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
          {verdictCounts.correct}
        </span>
        <span style={{ color: '#343b50' }}>·</span>
        <span className="inline-flex items-center gap-1" style={{ color: '#f87171' }}>
          <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
          {verdictCounts.wrong}
        </span>
        <span style={{ color: '#343b50' }}>·</span>
        <span className="inline-flex items-center gap-1" style={{ color: '#fbbf24' }}>
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
          {verdictCounts.unrealistic}
        </span>
        <span style={{ color: '#343b50' }}>·</span>
        <span style={{ color: '#aeb7c8' }}>
          {stats.completed}/{stats.total} reviewed
        </span>
      </div>
    ) : null

  // ── Render ────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col h-svh"
      style={{ background: '#0d1017', color: '#edf0f7' }}
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
            className="px-6 py-4 shrink-0 flex flex-col gap-3"
            style={{ background: '#191e2a', borderBottom: '1px solid #343b50' }}
          >
            {/* Dataset name + entity type selector */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="text-[11px] font-semibold uppercase tracking-widest mb-1"
                  style={{ color: '#aeb7c8' }}
                >
                  Active dataset
                </p>
                <h2 className="truncate text-base font-semibold" style={{ color: '#edf0f7' }}>
                  {activeDataset
                    ? `${activeDataset.source_key} · ${activeDataset.language}`
                    : 'No dataset selected'}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div
                  className="inline-flex overflow-hidden rounded-md"
                  style={{ border: '1px solid #343b50' }}
                >
                  {REVIEW_VIEW_MODES.map((mode, idx) => {
                    const isActive = viewMode === mode.value
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => handleSelectViewMode(mode.value)}
                        className="cursor-pointer select-none px-3.5 py-2 text-sm font-medium transition-[background-color,color] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                        style={{
                          borderLeft: idx > 0 ? '1px solid #343b50' : undefined,
                          background: isActive ? 'rgba(96,165,250,0.14)' : '#111722',
                          color: isActive ? '#60a5fa' : '#aeb7c8',
                        }}
                      >
                        {mode.label}
                      </button>
                    )
                  })}
                </div>

                <Select
                  value={activeEntityType ?? ALL_ENTITY_TYPES}
                  onValueChange={(v) => selectEntityType(v === ALL_ENTITY_TYPES ? null : v)}
                >
                  <SelectTrigger size="sm" className="w-56 shrink-0 text-sm">
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
                      className="cursor-pointer select-none px-3.5 py-2 text-sm font-medium transition-[background-color,border-color,color] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                      style={{
                        border: '1px solid',
                        borderColor: isActive ? '#60a5fa' : '#343b50',
                        borderLeft:
                          idx > 0
                            ? `1px solid ${isActive ? '#60a5fa' : '#343b50'}`
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
                        background: isActive ? 'rgba(96,165,250,0.12)' : '#191e2a',
                        color: isActive ? '#60a5fa' : '#aeb7c8',
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
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#aeb7c8]"
                />
                <input
                  type="search"
                  name="review-search"
                  aria-label="Search review items"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search value, reason, label, context…"
                  className="rounded-lg py-2 pl-10 pr-3.5 text-sm transition-[border-color,background-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                  style={{
                    background: '#111722',
                    border: '1px solid #343b50',
                    color: '#edf0f7',
                    width: 'min(320px, 100%)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#60a5fa')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#343b50')}
                />
              </div>

              {/* Sample ID search */}
              <div className="relative">
                <Hash
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#aeb7c8]"
                />
                <input
                  type="search"
                  name="sample-id-search"
                  aria-label="Search by sample IDs"
                  autoComplete="off"
                  value={sampleIdSearch}
                  onChange={(e) => setSampleIdSearch(e.target.value)}
                  placeholder="Sample IDs, comma or space separated"
                  className="rounded-lg py-2 pl-10 pr-3.5 text-sm transition-[border-color,background-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                  style={{
                    background: '#111722',
                    border: '1px solid #343b50',
                    color: '#edf0f7',
                    width: 'min(300px, 100%)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#60a5fa')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#343b50')}
                />
              </div>

              {/* Pagination controls */}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm tabular-nums" style={{ color: '#aeb7c8' }}>
                  {resultCountLabel}
                </span>
                {syncStatusLabel ? (
                  <span className="text-xs" style={{ color: syncing ? '#fbbf24' : '#7dd3fc' }}>
                    {syncStatusLabel}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingItems || syncing || saving || acquiringLock || modalItemId !== null}
                  onClick={handleRefreshPage}
                  aria-label={viewMode === 'labeled' ? 'Refresh current labeled items page' : 'Refresh current review items page'}
                >
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  Refresh
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingItems || pageInfo.pageIndex <= 1}
                  onClick={handlePreviousPage}
                  aria-label={viewMode === 'labeled' ? 'Previous labeled items page' : 'Previous review items page'}
                >
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingItems || !pageInfo.hasMore}
                  onClick={handleNextPage}
                  aria-label={viewMode === 'labeled' ? 'Next labeled items page' : 'Next review items page'}
                >
                  Next
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* ── Notice banner ── */}
          {notice && (
            <div
              className="px-6 py-3 text-sm shrink-0"
              style={{
                background: 'rgba(251,191,36,0.08)',
                borderBottom: '1px solid #343b50',
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
              <p className="text-base" style={{ color: '#aeb7c8' }}>
                {viewMode === 'labeled' ? 'Loading labeled items…' : 'Loading review items…'}
              </p>
            </div>
          ) : (
            <ReviewTable
              mode={viewMode}
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
          saving={saving || submittingItemId !== null}
          acquiringLock={acquiringLock}
          currentUserId={session.user.id}
          labelOptions={labelOptions}
          readOnly={activeItemReadOnly}
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
