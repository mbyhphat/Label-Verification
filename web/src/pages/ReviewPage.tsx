import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertTriangle, Check, Search, XCircle } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
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

  useEffect(() => {
    filteredItemsRef.current = filteredItems
  }, [filteredItems])

  useEffect(() => {
    submittedItemIdsRef.current = new Set()
  }, [activeDataset?.id, activeEntityType])

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
    async (
      item: ReviewItem,
      prefetchedBundle?: ReviewBundle,
      forceAcquireLock = false,
    ) => {
      setModalItemId(item.id)
      await Promise.all([
        openItem(item, prefetchedBundle, { forceAcquireLock }),
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
    if (decisionInFlightItemIdRef.current !== null) return

    setModalItemId(null)
    if (activeSample) {
      void releaseLock(activeSample.id)
    }
  }, [activeSample, releaseLock])

  const handleModalPrev = useCallback(() => {
    if (modalItemIndex > 0 && !acquiringLock && submittingItemId === null) {
      void navigateToItem(filteredItems[modalItemIndex - 1])
    }
  }, [modalItemIndex, filteredItems, acquiringLock, submittingItemId, navigateToItem])

  const handleModalNext = useCallback(() => {
    if (modalItemIndex < filteredItems.length - 1 && !acquiringLock && submittingItemId === null) {
      void navigateToItem(filteredItems[modalItemIndex + 1])
    }
  }, [modalItemIndex, filteredItems, acquiringLock, submittingItemId, navigateToItem])

  const handleModalSubmit = useCallback(
    async (
      item: ReviewItem,
      sample: ReviewSample,
      decision: ReviewDecision,
      reviewerNote: string,
    ) => {
      if (decisionInFlightItemIdRef.current !== null) {
        return
      }

      decisionInFlightItemIdRef.current = item.id
      setSubmittingItemId(item.id)

      try {
        // Pre-compute for opportunistic prefetching before the network round-trip.
        // This value may become stale if filteredItems is refreshed during submit,
        // so we re-compute the authoritative next item after submit completes.
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

        // Re-compute after submit so that filteredItems state refreshed during the
        // network call (e.g. silentRefreshItems) and the newly-submitted item are
        // both reflected — preventing navigation to a stale/already-accepted item.
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
          setModalItemId(null)
        }
      } finally {
        if (decisionInFlightItemIdRef.current === item.id) {
          decisionInFlightItemIdRef.current = null
          setSubmittingItemId(null)
        }
      }
    },
    [projectLabelOptions, releaseLock, submitDecision, navigateToItem],
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
                  placeholder="Search value, reason, label…"
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

              {/* Result count */}
              <span className="ml-auto text-sm" style={{ color: '#aeb7c8' }}>
                {filteredItems.length} / {items.length}
              </span>
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
          saving={saving || submittingItemId !== null}
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
