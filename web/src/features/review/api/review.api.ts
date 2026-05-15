import { supabase } from '@/lib/supabase/client'
import type {
  AuditEvent,
  Dataset,
  Json,
  PrivacyMaskEntry,
  ReviewBundle,
  ReviewDecision,
  ReviewItem,
  ReviewSample,
} from '@/types/domain'

type JsonRecord = { [key: string]: Json | undefined }

export type ReviewAuditExport = {
  exported_at: string
  dataset: {
    id: string
    source_key: string
    language: string
    folder: string | null
  }
  audit_events: AuditEvent[]
}

function isJsonRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function listReviewItems(datasetId: string): Promise<ReviewItem[]> {
  const { data, error } = await supabase
    .from('review_items')
    .select('*')
    .eq('dataset_id', datasetId)
    .order('status', { ascending: false })
    .order('entity_type', { ascending: true })
    .order('sample_key', { ascending: true })
    .order('audit_record_id', { ascending: true })

  if (error) throw error
  return data
}

export async function getReviewBundle(sampleId: string): Promise<ReviewBundle> {
  const [{ data: sample, error: sampleError }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase.from('review_samples').select('*').eq('id', sampleId).single(),
      supabase
        .from('review_items')
        .select('*')
        .eq('sample_row_id', sampleId)
        .order('audit_record_id', { ascending: true }),
    ])

  if (sampleError) throw sampleError
  if (itemsError) throw itemsError

  return { sample, items }
}

export async function acquireSampleLock(
  sample: ReviewSample,
  ttlSeconds = 120,
): Promise<ReviewSample> {
  const { data, error } = await supabase.rpc('acquire_sample_lock', {
    p_sample_id: sample.id,
    p_expected_version: sample.version,
    p_ttl_seconds: ttlSeconds,
  })

  if (error) throw error
  return data
}

/**
 * Single-round-trip alternative to getReviewBundle + acquireSampleLock.
 * Atomically acquires the lock and returns the sample row + all its review items.
 * Does NOT require a prior version number from the client.
 */
export async function openSample(sampleId: string, ttlSeconds = 120): Promise<ReviewBundle> {
  const { data, error } = await supabase.rpc('open_sample', {
    p_sample_id: sampleId,
    p_ttl_seconds: ttlSeconds,
  })

  if (error) throw error
  if (!data) throw new Error('No review bundle returned for sample.')

  return {
    sample: data.sample,
    items: data.items ?? [],
  }
}

export async function releaseSampleLock(sampleId: string): Promise<void> {
  const { error } = await supabase.rpc('release_sample_lock', {
    p_sample_id: sampleId,
  })

  if (error) throw error
}

export type SubmitDecisionArgs = {
  item: ReviewItem
  sample: ReviewSample
  decision: ReviewDecision
  reviewerNote: string
  sourceText: string
  privacyMask: PrivacyMaskEntry[]
}

export async function submitReviewDecision(args: SubmitDecisionArgs): Promise<Json> {
  const { data, error } = await supabase.rpc('submit_review_decision', {
    p_review_item_id: args.item.id,
    p_sample_version: args.sample.version,
    p_item_version: args.item.version,
    p_decision: args.decision,
    p_reviewer_note: args.reviewerNote || null,
    p_new_source_text: args.sourceText,
    p_new_privacy_mask: args.privacyMask as Json,
  })

  if (error) throw error
  return data
}

export async function exportReviewedDataset(datasetId: string): Promise<JsonRecord[]> {
  const { data: samples, error } = await supabase
    .from('review_samples')
    .select('*')
    .eq('dataset_id', datasetId)
    .order('sample_index', { ascending: true })

  if (error) throw error

  return samples.map((sample) => ({
    ...(isJsonRecord(sample.raw_output) ? sample.raw_output : {}),
    source_text: sample.current_source_text,
    language: sample.language,
    privacy_mask: sample.current_privacy_mask,
  }))
}

export async function exportReviewAudit(dataset: Dataset): Promise<ReviewAuditExport> {
  const { data: auditEvents, error } = await supabase
    .from('audit_events')
    .select('*')
    .eq('dataset_id', dataset.id)
    .order('created_at', { ascending: true })

  if (error) throw error

  return {
    exported_at: new Date().toISOString(),
    dataset: {
      id: dataset.id,
      source_key: dataset.source_key,
      language: dataset.language,
      folder: dataset.folder,
    },
    audit_events: auditEvents,
  }
}
