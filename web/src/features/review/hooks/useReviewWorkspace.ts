import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { formatSupabaseError } from '@/lib/supabase/errors'
import type { Dataset, ReviewDecision, ReviewItem, ReviewSample } from '@/types/domain'
import {
  acquireSampleLock,
  openSample,
  listReviewItems,
  releaseSampleLock,
  submitReviewDecision,
} from '../api/review.api'

function isLockValid(sample: ReviewSample | null, userId: string): boolean {
  return (
    sample?.locked_by === userId &&
    sample.locked_until != null &&
    new Date(sample.locked_until).getTime() > Date.now()
  )
}
import { listDatasets } from '../api/dataset.api'
import { buildDecisionPreview } from '../utils/review.service'
import { useReviewRealtime } from './useReviewRealtime'

type ReviewStats = {
  pending: number
  completed: number
  total: number
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
  openItem: (item: ReviewItem) => Promise<void>
  submitDecision: (
    item: ReviewItem,
    sample: ReviewSample,
    decision: ReviewDecision,
    reviewerNote: string,
  ) => Promise<void>
  releaseLock: (sampleId: string) => Promise<void>
}

function computeStats(items: ReviewItem[]): ReviewStats {
  const completed = items.filter((item) => item.status === 'completed').length
  const pending = items.filter((item) => item.status === 'pending').length
  return { completed, pending, total: items.length }
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

  const entityTypes = useMemo(
    () => Array.from(new Set(allItems.map((item) => item.entity_type))).sort(),
    [allItems],
  )

  const items = useMemo(() => {
    if (!activeEntityType) return allItems
    return allItems.filter((item) => item.entity_type === activeEntityType)
  }, [activeEntityType, allItems])

  const stats = useMemo(() => computeStats(items), [items])

  // ── Realtime handlers ──────────────────────────────────────────────

  const handleSampleChange = useCallback((sample: ReviewSample) => {
    setSamplesById((prev) => new Map(prev).set(sample.id, sample))
    setActiveSample((prev) => (prev?.id === sample.id ? sample : prev))
  }, [])

  const handleItemChange = useCallback((item: ReviewItem) => {
    setAllItems((prev) => {
      const idx = prev.findIndex((c) => c.id === item.id)
      if (idx === -1) return [item, ...prev]
      const next = [...prev]
      next[idx] = item
      return next
    })
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

  // ── Bootstrap: load datasets on mount ─────────────────────────────

  useEffect(() => {
    async function init() {
      setLoadingDatasets(true)
      try {
        const list = await listDatasets()
        setDatasets(list)
        if (list.length > 0) {
          setActiveDataset(list[0])
          await loadItems(list[0])
        }
      } catch (err) {
        setNotice(formatSupabaseError(err))
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
    async (item: ReviewItem) => {
      setNotice('')

      const isSameSample = activeSample?.id === item.sample_row_id

      // Fast path: lock on this sample is still valid → just switch the active item,
      // no network calls needed.
      if (isSameSample && isLockValid(activeSample, session.user.id)) {
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

      setAcquiringLock(true)
      try {
        // Fire release concurrently — it targets the OLD sample, so it does not
        // block opening the new one. Non-fatal if the lock has already expired.
        if (activeSample?.id && !isSameSample) {
          void releaseSampleLock(activeSample.id).catch(() => {})
        }

        // Single round-trip: acquires lock + fetches items atomically.
        // No p_expected_version required — the RPC handles conflict detection.
        const bundle = await openSample(item.sample_row_id, 120)
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
    ) => {
      setSaving(true)
      setNotice('')
      try {
        const preview = buildDecisionPreview(sample, item, decision)
        await submitReviewDecision({
          item,
          sample,
          decision,
          reviewerNote,
          sourceText: preview.sourceText,
          privacyMask: preview.privacyMask,
        })
        if (activeDataset) await loadItems(activeDataset, false)
        setNotice('Saved. Lock released automatically.')
      } catch (err) {
        setNotice(formatSupabaseError(err))
      } finally {
        setSaving(false)
      }
    },
    [activeDataset, loadItems],
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
    releaseLock: releaseSampleLock,
  }
}
