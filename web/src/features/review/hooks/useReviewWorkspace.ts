import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { formatSupabaseError } from '@/lib/supabase/errors'
import type {
  Dataset,
  PrivacyMaskEntry,
  ReviewBundle,
  ReviewDecision,
  ReviewItem,
  ReviewSample,
} from '@/types/domain'
import {
  acquireSampleLock,
  openSample,
  listReviewItems,
  releaseSampleLock,
  submitReviewDecision,
  updateReviewSampleMask,
} from '../api/review.api'
import { listDatasets } from '../api/dataset.api'
import { buildDecisionPreview } from '../utils/review.service'
import { useReviewRealtime } from './useReviewRealtime'

const LAST_DATASET_KEY = 'pii-last-dataset-id'

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
}

type OpenItemOptions = {
  forceAcquireLock?: boolean
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
  selectDataset: (dataset: Dataset) => Promise<void>
  selectEntityType: (entityType: string | null) => void
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

function computeStats(items: ReviewItem[]): ReviewStats {
  const completed = items.filter((item) => item.status === 'completed').length
  const pending = items.filter((item) => item.status === 'pending').length
  return { completed, pending, total: items.length }
}

function upsertReviewItem(items: ReviewItem[], item: ReviewItem): ReviewItem[] {
  const idx = items.findIndex((current) => current.id === item.id)
  if (idx === -1) return [item, ...items]

  const next = [...items]
  next[idx] = item
  return next
}

export function useReviewWorkspace(session: Session): ReviewWorkspaceState {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [activeDataset, setActiveDataset] = useState<Dataset | null>(null)
  const [allItems, setAllItems] = useState<ReviewItem[]>([])
  const [activeEntityType, setActiveEntityType] = useState<string | null>(null)
  const [samplesById, setSamplesById] = useState<Map<string, ReviewSample>>(() => new Map())
  const [activeItem, setActiveItem] = useState<ReviewItem | null>(null)
  const [activeSample, setActiveSample] = useState<ReviewSample | null>(null)
  const [loadingDatasets, setLoadingDatasets] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [acquiringLock, setAcquiringLock] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const activeDatasetIdRef = useRef<string | null>(null)

  const entityTypes = useMemo(
    () => Array.from(new Set(allItems.map((item) => item.entity_type))).sort(),
    [allItems],
  )

  const items = useMemo(() => {
    if (!activeEntityType) return allItems
    return allItems.filter((item) => item.entity_type === activeEntityType)
  }, [activeEntityType, allItems])

  const stats = useMemo(() => computeStats(items), [items])

  useEffect(() => {
    activeDatasetIdRef.current = activeDataset?.id ?? null
  }, [activeDataset?.id])

  // ── Realtime handlers ──────────────────────────────────────────────

  const handleSampleChange = useCallback((sample: ReviewSample) => {
    setSamplesById((prev) => new Map(prev).set(sample.id, sample))
    setActiveSample((prev) => (prev?.id === sample.id ? sample : prev))
  }, [])

  const handleItemChange = useCallback((item: ReviewItem) => {
    setAllItems((prev) => upsertReviewItem(prev, item))
    setActiveItem((prev) => (prev?.id === item.id ? item : prev))
  }, [])

  useReviewRealtime({
    datasetId: activeDataset?.id ?? null,
    onSampleChange: handleSampleChange,
    onItemChange: handleItemChange,
  })

  // ── Internal helpers ───────────────────────────────────────────────

  const loadItems = useCallback(async (dataset: Dataset, resetEntityType = true) => {
    setLoadingItems(true)
    setNotice('')
    try {
      const nextItems = await listReviewItems(dataset.id)
      setAllItems(nextItems)
      if (resetEntityType) setActiveEntityType(null)
      setSamplesById(new Map())
      setActiveItem(null)
      setActiveSample(null)
    } catch (err) {
      setNotice(formatSupabaseError(err))
    } finally {
      setLoadingItems(false)
    }
  }, [])

  const silentRefreshItems = useCallback(async (datasetId: string) => {
    try {
      const nextItems = await listReviewItems(datasetId)
      if (activeDatasetIdRef.current === datasetId) {
        setAllItems(nextItems)
      }
    } catch {
      // Non-fatal: rows were already patched from submit_review_decision response.
    }
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

  // ── Bootstrap: load datasets + (optionally) items in parallel ───────

  useEffect(() => {
    async function init() {
      const lastId = getLastDatasetId()
      setLoadingDatasets(true)
      if (lastId) setLoadingItems(true)

      try {
        const [list, prefetchedItems] = await Promise.all([
          listDatasets(),
          lastId ? listReviewItems(lastId).catch(() => null) : Promise.resolve(null),
        ])

        setDatasets(list)

        if (list.length === 0) {
          activeDatasetIdRef.current = null
          setActiveDataset(null)
          setAllItems([])
          setLoadingItems(false)
          return
        }

        const target = list.find((d) => d.id === lastId) ?? list[0]
        activeDatasetIdRef.current = target.id
        setActiveDataset(target)
        saveLastDatasetId(target.id)

        if (prefetchedItems !== null && target.id === lastId) {
          setAllItems(prefetchedItems)
          setActiveEntityType(null)
          setSamplesById(new Map())
          setActiveItem(null)
          setActiveSample(null)
          setLoadingItems(false)
        } else {
          await loadItems(target)
        }
      } catch (err) {
        setNotice(formatSupabaseError(err))
        setLoadingItems(false)
      } finally {
        setLoadingDatasets(false)
      }
    }
    void init()
  }, [loadItems])

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
      await loadItems(dataset)
    },
    [activeSample?.locked_by, session.user.id, releaseActive, loadItems],
  )

  const selectEntityType = useCallback(
    (entityType: string | null) => {
      if (activeSample?.locked_by === session.user.id) {
        void releaseActive()
      }
      setActiveEntityType(entityType)
      setActiveItem(null)
      setActiveSample(null)
    },
    [activeSample?.locked_by, session.user.id, releaseActive],
  )

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

      // Fast path: lock on this sample is still valid → just switch the active item,
      // no network calls needed.
      if (!options.forceAcquireLock && isSameSample && isLockValid(activeSample, session.user.id)) {
        setActiveItem(allItems.find((c) => c.id === item.id) ?? item)
        return
      }

      // Optimistic: surface item metadata immediately so the modal shows content
      // while the lock is being acquired in the background.
      setActiveItem(allItems.find((c) => c.id === item.id) ?? item)

      // Show cached sample immediately (enables source-context rendering without waiting).
      // If we're switching samples, clear first so the modal doesn't briefly show the wrong context.
      const cachedSample = samplesById.get(item.sample_row_id)
      setActiveSample(isSameSample ? (activeSample ?? null) : (cachedSample ?? null))

      // Only signal "acquiring" when a real network round-trip is needed.
      // When a matching bundle was prefetched the lock is already held, so the
      // entire path is synchronous — no UI gate required.
      if (!hasMatchingPrefetch) {
        setAcquiringLock(true)
      }
      try {
        // Fire release concurrently — it targets the OLD sample, so it does not
        // block opening the new one. Non-fatal if the lock has already expired.
        if (activeSample?.id && !isSameSample) {
          void releaseSampleLock(activeSample.id).catch(() => {})
        }

        // Single round-trip: acquires lock + fetches items atomically, unless a
        // matching bundle was prefetched in parallel with submit_review_decision.
        const bundle = hasMatchingPrefetch
          ? prefetchedBundle
          : await openSample(item.sample_row_id, 120)
        setSamplesById((prev) => new Map(prev).set(bundle.sample.id, bundle.sample))
        setActiveSample(bundle.sample)
      } catch (err) {
        setNotice(formatSupabaseError(err))
      } finally {
        // Always ensure acquiringLock is cleared. If we skipped setAcquiringLock(true)
        // above (prefetch path), calling setAcquiringLock(false) on an already-false
        // state is a no-op in React (no re-render triggered).
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
        setAllItems((prev) => upsertReviewItem(prev, result.item))
        setActiveItem((prev) => (prev?.id === result.item.id ? result.item : prev))
        setSamplesById((prev) => new Map(prev).set(result.sample.id, result.sample))
        setActiveSample((prev) => (prev?.id === result.sample.id ? result.sample : prev))
        if (activeDatasetIdRef.current) void silentRefreshItems(activeDatasetIdRef.current)
        setNotice('Saved. Lock released automatically.')
        return true
      } catch (err) {
        setNotice(formatSupabaseError(err))
        return false
      } finally {
        setSaving(false)
      }
    },
    [silentRefreshItems],
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
        setNotice('Sample text and labels updated.')
      } catch (err) {
        setNotice(formatSupabaseError(err))
        throw err
      } finally {
        setSaving(false)
      }
    },
    [session.user.id],
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
    selectDataset,
    selectEntityType,
    openItem,
    submitDecision,
    saveSampleMask,
    releaseLock: releaseSampleLock,
  }
}
