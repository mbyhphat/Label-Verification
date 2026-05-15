import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { ReviewItem, ReviewSample } from '@/types/domain'

type UseReviewRealtimeArgs = {
  datasetId: string | null
  onSampleChange: (sample: ReviewSample) => void
  onItemChange: (item: ReviewItem) => void
}

export function useReviewRealtime({
  datasetId,
  onSampleChange,
  onItemChange,
}: UseReviewRealtimeArgs) {
  useEffect(() => {
    if (!datasetId) return undefined

    const channel = supabase
      .channel(`review:${datasetId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'review_samples', filter: `dataset_id=eq.${datasetId}` },
        (payload) => {
          if (payload.new) onSampleChange(payload.new as ReviewSample)
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'review_items', filter: `dataset_id=eq.${datasetId}` },
        (payload) => {
          if (payload.new) onItemChange(payload.new as ReviewItem)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [datasetId, onItemChange, onSampleChange])
}
