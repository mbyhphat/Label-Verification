import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { formatSupabaseError } from '@/lib/supabase/errors'
import type {
  Dataset,
  Json,
  PrivacyMaskEntry,
  ReviewBundle,
  ReviewDecision,
  ReviewItem,
  ReviewSample,
} from '@/types/domain'
import {
  acquireSampleLock,
  countReviewItemsFiltered,
  fetchReviewItemsPage,
  openSample,
  releaseSampleLock,
  submitReviewDecision,
  updateReviewSampleMask,
} from '../api/review.api'
import type { DatasetReviewItemCounts } from '../api/review.api'
import { listDatasets } from '../api/dataset.api'
import { buildDecisionPreview } from '../utils/review.service'

const LAST_DATASET_KEY = 'pii-last-dataset-id'
const REVIEW_ITEMS_PAGE_SIZE = 250
const REVIEW_PAGE_POLL_INTERVAL_MS = 60_000
const REVIEW_COUNTS_POLL_INTERVAL_MS = 120_000

export type CountsStatus = 'idle' | 'loading' | 'ready' | 'error'

function getLastDatasetId(): string | null {
  return localStorage.getItem(LAST_DATASET_KEY)
}

function saveLastDatasetId(id: string): void {
  localStorage.setItem(LAST_DATASET_KEY, id)
}

function isLockValid(sample: ReviewSample | null, userId: string): boolean {
  return (
    sample?.locked_by === userId &&
    sample.locked_until != null &&
    new Date(sample.locked_until).getTime() > Date.now()
  )
}

type ReviewStats = {
  pending: number
  completed: number
  total: number
  correct: number
  wrong_label: number
  unrealistic_value: number
}

export type ReviewPageInfo = {
  pageIndex: number
  pageSize: number
  currentCursor: Json | null
  nextCursor: Json | null
  hasMore: boolean
  previousCursors: Array<Json | null>
  filteredTotal: number | null
}

export type ReviewWorkspaceFilters = {
  verdict?: ReviewItem['verdict'] | null
  search?: string | null
  pagePollingPaused?: boolean
}

type OpenItemOptions = {
  forceAcquireLock?: boolean
}

type LoadItemsOptions = {
  cursor?: Json | null
  pageIndex?: number
  previousCursors?: Array<Json | null>
  showLoading?: boolean
  clearActive?: boolean
  showNotice?: boolean
}

export type ReviewWorkspaceState = {
  datasets: Dataset[]
  activeDataset: Dataset | null
  entityTypes: string[]
  activeEntityType: string | null
  items: ReviewItem[]
  samplesById: Map<string, ReviewSample>
  activeItem: ReviewItem | null
  activeSample: ReviewSample | null
  loadingDatasets: boolean
  loadingItems: boolean
  acquiringLock: boolean
  saving: boolean
  notice: string
  stats: ReviewStats
  pageInfo: ReviewPageInfo
  syncing: boolean
  lastSyncedAt: string | null
  countsStatus: CountsStatus
  selectDataset: (dataset: Dataset) => Promise<void>
  selectEntityType: (entityType: string | null) => void
  loadNextPage: () => Promise<ReviewItem[]>
  loadPreviousPage: () => Promise<ReviewItem[]>
  refreshCurrentPage: () => Promise<ReviewItem[]>
  refreshCounts: () => Promise<void>
  openItem: (
    item: ReviewItem,
    prefetchedBundle?: ReviewBundle,
    options?: OpenItemOptions,
  ) => Promise<void>
  submitDecision: (
    item: ReviewItem,
    sample: ReviewSample,
    decision: ReviewDecision,
    reviewerNote: string,
    projectLabels?: string[],
  ) => Promise<boolean>
  saveSampleMask: (
    item: ReviewItem,
    sample: ReviewSample,
    sourceText: string,
    privacyMask: PrivacyMaskEntry[],
  ) => Promise<void>
  releaseLock: (sampleId: string) => Promise<void>
}

function createEmptyCounts(): DatasetReviewItemCounts {
  return {
    filtered_total: 0,
    total: 0,
    pending: 0,
    completed: 0,
    skipped: 0,
    correct: 0,
    wrong_label: 0,
    unrealistic_value: 0,
    entity_types: [],
  }
}

function createInitialPageInfo(): ReviewPageInfo {
  return {
    pageIndex: 1,
    pageSize: REVIEW_ITEMS_PAGE_SIZE,
    currentCursor: null,
    nextCursor: null,
    hasMore: false,
    previousCursors: [],
    filteredTotal: null,
  }
}

function patchReviewItem(items: ReviewItem[], item: ReviewItem): ReviewItem[] {
  const idx = items.findIndex((current) => current.id === item.id)
  if (idx === -1) return items

  const next = [...items]
  next[idx] = item
  return next
}

export function useReviewWorkspace(
  session: Session,
  filters: ReviewWorkspaceFilters = {},
): ReviewWorkspaceState {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [activeDataset, setActiveDataset] = useState<Dataset | null>(null)
  const [allItems, setAllItems] = useState<ReviewItem[]>([])
  const [activeEntityType, setActiveEntityType] = useState<string | null>(null)
  const [availableEntityTypes, setAvailableEntityTypes] = useState<string[]>([])
  const [reviewCounts, setReviewCounts] = useState<DatasetReviewItemCounts>(() => createEmptyCounts())
  const [pageInfo, setPageInfo] = useState<ReviewPageInfo>(() => createInitialPageInfo())
  const [samplesById, setSamplesById] = useState<Map<string, ReviewSample>>(() => new Map())
  const [activeItem, setActiveItem] = useState<ReviewItem | null>(null)
  const [activeSample, setActiveSample] = useState<ReviewSample | null>(null)
  const [loadingDatasets, setLoadingDatasets] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [acquiringLock, setAcquiringLock] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [countsStatus, setCountsStatus] = useState<CountsStatus>('idle')
  const activeDatasetIdRef = useRef<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const countsRefreshInFlightRef = useRef(false)
  const pageRefreshInFlightRef = useRef(false)
  const allItemsRef = useRef<ReviewItem[]>([])
  const loadingItemsRef = useRef(false)
  const savingRef = useRef(false)
  const acquiringLockRef = useRef(false)
  const pagePollingPausedRef = useRef(false)

  const verdictFilter = filters.verdict ?? null
  const searchFilter = filters.search?.trim() || null
  const pagePollingPaused = filters.pagePollingPaused === true

  const entityTypes = availableEntityTypes
  const items = allItems

  const stats = useMemo(
    () => ({
      pending: reviewCounts.pending,
      completed: reviewCounts.completed,
      total: reviewCounts.filtered_total,
      correct: reviewCounts.correct,
      wrong_label: reviewCounts.wrong_label,
      unrealistic_value: reviewCounts.unrealistic_value,
    }),
    [
      reviewCounts.completed,
      reviewCounts.correct,
      reviewCounts.filtered_total,
      reviewCounts.pending,
      reviewCounts.unrealistic_value,
      reviewCounts.wrong_label,
    ],
  )

  useEffect(() => {
    activeDatasetIdRef.current = activeDataset?.id ?? null
  }, [activeDataset?.id])

  useEffect(() => {
    allItemsRef.current = allItems
  }, [allItems])

  useEffect(() => {
    loadingItemsRef.current = loadingItems
  }, [loadingItems])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  useEffect(() => {
    acquiringLockRef.current = acquiringLock
  }, [acquiringLock])

  useEffect(() => {
    pagePollingPausedRef.current = pagePollingPaused
  }, [pagePollingPaused])

  const refreshCounts = useCallback(async () => {
    const datasetId = activeDatasetIdRef.current
    if (!datasetId || countsRefreshInFlightRef.current) return

    countsRefreshInFlightRef.current = true
    setCountsStatus('loading')

    try {
      const nextCounts = await countReviewItemsFiltered({
        datasetId,
        limit: REVIEW_ITEMS_PAGE_SIZE,
        entityType: activeEntityType,
        verdict: verdictFilter,
        search: searchFilter,
      })

      if (activeDatasetIdRef.current !== datasetId) return
      setReviewCounts(nextCounts)
      setAvailableEntityTypes(nextCounts.entity_types)
      setPageInfo((prev) => ({ ...prev, filteredTotal: nextCounts.filtered_total }))
      setCountsStatus('ready')
    } catch {
      if (activeDatasetIdRef.current === datasetId) {
        setCountsStatus('error')
      }
    } finally {
      countsRefreshInFlightRef.current = false
    }
  }, [activeEntityType, searchFilter, verdictFilter])

  // ── Internal helpers ───────────────────────────────────────────────

  const loadItems = useCallback(
    async (dataset: Dataset, options: LoadItemsOptions = {}) => {
      const requestId = loadRequestIdRef.current + 1
      loadRequestIdRef.current = requestId
      const cursor = options.cursor ?? null
      const pageIndex = options.pageIndex ?? 1
      const previousCursors = options.previousCursors ?? []
      const showLoading = options.showLoading ?? true
      const clearActive = options.clearActive ?? true
      const showNotice = options.showNotice ?? showLoading

      if (showLoading) {
        setLoadingItems(true)
        setNotice('Loading review items...')
      } else if (showNotice) {
        setNotice('Refreshing...')
      }

      try {
        const nextPage = await fetchReviewItemsPage({
          datasetId: dataset.id,
          limit: REVIEW_ITEMS_PAGE_SIZE,
          after: cursor,
          entityType: activeEntityType,
          verdict: verdictFilter,
          search: searchFilter,
        })

        if (loadRequestIdRef.current !== requestId || activeDatasetIdRef.current !== dataset.id) {
          return []
        }

        setAllItems(nextPage.items)
        setPageInfo((prev) => ({
          pageIndex,
          pageSize: REVIEW_ITEMS_PAGE_SIZE,
          currentCursor: cursor,
          nextCursor: nextPage.next_after,
          hasMore: nextPage.has_more,
          previousCursors,
          filteredTotal: showLoading ? null : prev.filteredTotal,
        }))
        if (clearActive) {
          setSamplesById(new Map())
          setActiveItem(null)
          setActiveSample(null)
        }
        setLastSyncedAt(new Date().toISOString())
        if (showNotice) {
          setNotice(showLoading ? '' : 'Updated just now.')
        }
        void refreshCounts()
        return nextPage.items
      } catch (err) {
        if (loadRequestIdRef.current === requestId && showNotice) {
          setNotice(formatSupabaseError(err))
        }
        return []
      } finally {
        if (loadRequestIdRef.current === requestId && showLoading) {
          setLoadingItems(false)
        }
      }
    },
    [activeEntityType, refreshCounts, searchFilter, verdictFilter],
  )

  const refreshCurrentPageInternal = useCallback(
    async (showNotice: boolean) => {
      if (!activeDataset) return []
      if (pageRefreshInFlightRef.current) return allItemsRef.current

      pageRefreshInFlightRef.current = true
      setSyncing(true)

      try {
        const rows = await loadItems(activeDataset, {
          cursor: pageInfo.currentCursor,
          pageIndex: pageInfo.pageIndex,
          previousCursors: pageInfo.previousCursors,
          showLoading: false,
          clearActive: false,
          showNotice,
        })

        if (rows.length === 0 && pageInfo.pageIndex > 1) {
          const nextPreviousCursors = pageInfo.previousCursors.slice(0, -1)
          const previousCursor = pageInfo.previousCursors[pageInfo.previousCursors.length - 1] ?? null

          return loadItems(activeDataset, {
            cursor: previousCursor,
            pageIndex: Math.max(pageInfo.pageIndex - 1, 1),
            previousCursors: nextPreviousCursors,
            showLoading: false,
            clearActive: false,
            showNotice,
          })
        }

        return rows
      } finally {
        pageRefreshInFlightRef.current = false
        setSyncing(false)
      }
    },
    [activeDataset, loadItems, pageInfo],
  )

  const refreshCurrentPage = useCallback(
    () => refreshCurrentPageInternal(true),
    [refreshCurrentPageInternal],
  )

  const canPollPage = useCallback(() => {
    return (
      activeDatasetIdRef.current !== null &&
      document.visibilityState === 'visible' &&
      !pagePollingPausedRef.current &&
      !loadingItemsRef.current &&
      !savingRef.current &&
      !acquiringLockRef.current
    )
  }, [])

  const releaseActive = useCallback(async () => {
    if (!activeSample) return
    try {
      await releaseSampleLock(activeSample.id)
      setActiveSample((prev) =>
        prev ? { ...prev, locked_by: null, locked_until: null } : prev,
      )
    } catch (err) {
      setNotice(formatSupabaseError(err))
    }
  }, [activeSample])

  // ── Bootstrap datasets; page loading is handled by the dataset/filter effect.

  useEffect(() => {
    let cancelled = false

    async function init() {
      const lastId = getLastDatasetId()
      setLoadingDatasets(true)

      try {
        const list = await listDatasets()
        if (cancelled) return

        setDatasets(list)

        if (list.length === 0) {
          activeDatasetIdRef.current = null
          setActiveDataset(null)
          setAllItems([])
          setAvailableEntityTypes([])
          setReviewCounts(createEmptyCounts())
          setPageInfo(createInitialPageInfo())
          setCountsStatus('idle')
          setLastSyncedAt(null)
          return
        }

        const target = list.find((d) => d.id === lastId) ?? list[0]
        activeDatasetIdRef.current = target.id
        setActiveDataset(target)
        saveLastDatasetId(target.id)
      } catch (err) {
        if (!cancelled) setNotice(formatSupabaseError(err))
      } finally {
        if (!cancelled) setLoadingDatasets(false)
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeDataset) return undefined

    const timer = window.setTimeout(() => {
      void loadItems(activeDataset)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [activeDataset, loadItems])

  useEffect(() => {
    if (!activeDataset) return undefined

    const timer = window.setInterval(() => {
      if (canPollPage()) void refreshCurrentPageInternal(false)
    }, REVIEW_PAGE_POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [activeDataset, canPollPage, refreshCurrentPageInternal])

  useEffect(() => {
    if (!activeDataset) return undefined

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCounts()
    }, REVIEW_COUNTS_POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [activeDataset, refreshCounts])

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState !== 'visible') return
      void refreshCounts()
      if (canPollPage()) void refreshCurrentPageInternal(false)
    }

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [canPollPage, refreshCounts, refreshCurrentPageInternal])

  // ── Lock refresh: renew every 30 s while held ──────────────────────

  useEffect(() => {
    if (!activeSample) return undefined

    const timer = window.setInterval(() => {
      const isOwnLock =
        activeSample.locked_by === session.user.id &&
        activeSample.locked_until &&
        new Date(activeSample.locked_until).getTime() > Date.now()

      if (isOwnLock) {
        void acquireSampleLock(activeSample, 120)
          .then((refreshed) => setActiveSample(refreshed))
          .catch((err) => setNotice(formatSupabaseError(err)))
      }
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [activeSample, session.user.id])

  // ── Public actions ─────────────────────────────────────────────────

  const selectDataset = useCallback(
    async (dataset: Dataset) => {
      if (activeSample?.locked_by === session.user.id) {
        await releaseActive()
      }
      saveLastDatasetId(dataset.id)
      activeDatasetIdRef.current = dataset.id
      setActiveDataset(dataset)
      setActiveEntityType(null)
      setAllItems([])
      setAvailableEntityTypes([])
      setReviewCounts(createEmptyCounts())
      setSamplesById(new Map())
      setActiveItem(null)
      setActiveSample(null)
      setPageInfo(createInitialPageInfo())
      setCountsStatus('idle')
      setLastSyncedAt(null)
    },
    [activeSample?.locked_by, session.user.id, releaseActive],
  )

  const selectEntityType = useCallback(
    (entityType: string | null) => {
      if (activeSample?.locked_by === session.user.id) {
        void releaseActive()
      }
      setActiveEntityType(entityType)
      setAllItems([])
      setReviewCounts({ ...createEmptyCounts(), entity_types: availableEntityTypes })
      setActiveItem(null)
      setActiveSample(null)
      setPageInfo(createInitialPageInfo())
      setCountsStatus('idle')
      setLastSyncedAt(null)
    },
    [activeSample?.locked_by, availableEntityTypes, session.user.id, releaseActive],
  )

  const loadNextPage = useCallback(async () => {
    if (!activeDataset || !pageInfo.hasMore || !pageInfo.nextCursor) return []

    return loadItems(activeDataset, {
      cursor: pageInfo.nextCursor,
      pageIndex: pageInfo.pageIndex + 1,
      previousCursors: [...pageInfo.previousCursors, pageInfo.currentCursor],
    })
  }, [activeDataset, loadItems, pageInfo])

  const loadPreviousPage = useCallback(async () => {
    if (!activeDataset || pageInfo.pageIndex <= 1) return []

    const nextPreviousCursors = pageInfo.previousCursors.slice(0, -1)
    const previousCursor = pageInfo.previousCursors[pageInfo.previousCursors.length - 1] ?? null

    return loadItems(activeDataset, {
      cursor: previousCursor,
      pageIndex: Math.max(pageInfo.pageIndex - 1, 1),
      previousCursors: nextPreviousCursors,
    })
  }, [activeDataset, loadItems, pageInfo])

  const openItem = useCallback(
    async (
      item: ReviewItem,
      prefetchedBundle?: ReviewBundle,
      options: OpenItemOptions = {},
    ) => {
      setNotice('')

      const isSameSample = activeSample?.id === item.sample_row_id
      const hasMatchingPrefetch = prefetchedBundle?.sample.id === item.sample_row_id

      if (prefetchedBundle && !hasMatchingPrefetch) {
        void releaseSampleLock(prefetchedBundle.sample.id).catch(() => {})
      }

      // Fast path: lock on this sample is still valid -> just switch the active item.
      if (!options.forceAcquireLock && isSameSample && isLockValid(activeSample, session.user.id)) {
        setActiveItem(allItems.find((c) => c.id === item.id) ?? item)
        return
      }

      setActiveItem(allItems.find((c) => c.id === item.id) ?? item)

      const cachedSample = samplesById.get(item.sample_row_id)
      setActiveSample(isSameSample ? (activeSample ?? null) : (cachedSample ?? null))

      if (!hasMatchingPrefetch) {
        setAcquiringLock(true)
      }
      try {
        if (activeSample?.id && !isSameSample) {
          void releaseSampleLock(activeSample.id).catch(() => {})
        }

        const bundle = hasMatchingPrefetch
          ? prefetchedBundle
          : await openSample(item.sample_row_id, 120)
        setSamplesById((prev) => new Map(prev).set(bundle.sample.id, bundle.sample))
        setActiveSample(bundle.sample)
      } catch (err) {
        setNotice(formatSupabaseError(err))
      } finally {
        setAcquiringLock(false)
      }
    },
    [activeSample, session.user.id, allItems, samplesById],
  )

  const submitDecision = useCallback(
    async (
      item: ReviewItem,
      sample: ReviewSample,
      decision: ReviewDecision,
      reviewerNote: string,
      projectLabels: string[] = [],
    ) => {
      setSaving(true)
      setNotice('')
      try {
        const preview = buildDecisionPreview(sample, item, decision, { projectLabels })
        const result = await submitReviewDecision({
          item,
          sample,
          decision,
          reviewerNote,
          sourceText: preview.sourceText,
          privacyMask: preview.privacyMask,
        })
        setAllItems((prev) => patchReviewItem(prev, result.item))
        setActiveItem((prev) => (prev?.id === result.item.id ? result.item : prev))
        setSamplesById((prev) => new Map(prev).set(result.sample.id, result.sample))
        setActiveSample((prev) => (prev?.id === result.sample.id ? result.sample : prev))
        void refreshCounts()
        setNotice('Saved. Lock released automatically.')
        return true
      } catch (err) {
        setNotice(formatSupabaseError(err))
        return false
      } finally {
        setSaving(false)
      }
    },
    [refreshCounts],
  )

  const saveSampleMask = useCallback(
    async (
      item: ReviewItem,
      sample: ReviewSample,
      sourceText: string,
      privacyMask: PrivacyMaskEntry[],
    ) => {
      setSaving(true)
      setNotice('')
      try {
        const updated = await updateReviewSampleMask({ item, sample, sourceText, privacyMask })
        const submittedAt = new Date().toISOString()
        const markSubmitted = (current: ReviewItem): ReviewItem => {
          if (current.status !== 'pending') return current
          return {
            ...current,
            status: 'completed',
            decision: 'accept',
            decided_by: session.user.id,
            decided_at: submittedAt,
            version: current.version + 1,
            updated_at: submittedAt,
          }
        }

        setSamplesById((prev) => new Map(prev).set(updated.id, updated))
        setActiveSample((prev) => (prev?.id === updated.id ? updated : prev))
        setAllItems((prev) =>
          prev.map((current) => (current.id === item.id ? markSubmitted(current) : current)),
        )
        setActiveItem((prev) => (prev?.id === item.id ? markSubmitted(prev) : prev))
        void refreshCounts()
        setNotice('Sample text and labels updated.')
      } catch (err) {
        setNotice(formatSupabaseError(err))
        throw err
      } finally {
        setSaving(false)
      }
    },
    [refreshCounts, session.user.id],
  )

  return {
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
    pageInfo,
    syncing,
    lastSyncedAt,
    countsStatus,
    selectDataset,
    selectEntityType,
    loadNextPage,
    loadPreviousPage,
    refreshCurrentPage,
    refreshCounts,
    openItem,
    submitDecision,
    saveSampleMask,
    releaseLock: releaseSampleLock,
  }
}
