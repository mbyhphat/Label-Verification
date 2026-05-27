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

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const SAMPLE_EXPORT_PAGE_SIZE = 1000
const SAMPLE_ID_SEARCH_CHUNK_SIZE = 75
const SAMPLE_ID_SEARCH_LIMIT = 500

function isJsonRecordWithId(value: unknown): value is JsonRecord & { id: string } {
  return isJsonRecord(value) && typeof value.id === 'string'
}

export type DatasetReviewItemCounts = {
  filtered_total: number
  total: number
  pending: number
  completed: number
  skipped: number
  correct: number
  wrong_label: number
  unrealistic_value: number
  entity_types: string[]
}

function parseDatasetReviewCounts(data: unknown): DatasetReviewItemCounts {
  if (!isJsonRecord(data)) {
    throw new Error('Invalid count_review_items_filtered response.')
  }
  const et = data.entity_types
  const entityTypes = Array.isArray(et)
    ? et.filter((x): x is string => typeof x === 'string')
    : []
  return {
    filtered_total:
      typeof data.filtered_total === 'number'
        ? data.filtered_total
        : Number(data.filtered_total) || 0,
    total: typeof data.total === 'number' ? data.total : Number(data.total) || 0,
    pending: typeof data.pending === 'number' ? data.pending : Number(data.pending) || 0,
    completed: typeof data.completed === 'number' ? data.completed : Number(data.completed) || 0,
    skipped: typeof data.skipped === 'number' ? data.skipped : Number(data.skipped) || 0,
    correct: typeof data.correct === 'number' ? data.correct : Number(data.correct) || 0,
    wrong_label:
      typeof data.wrong_label === 'number' ? data.wrong_label : Number(data.wrong_label) || 0,
    unrealistic_value:
      typeof data.unrealistic_value === 'number'
        ? data.unrealistic_value
        : Number(data.unrealistic_value) || 0,
    entity_types: entityTypes,
  }
}

function parseListReviewItemsPagePayload(data: unknown): {
  items: ReviewItem[]
  next_after: Json | null
  has_more: boolean
} {
  if (!isJsonRecord(data)) {
    throw new Error('Invalid list_review_items_page_v2 response.')
  }
  const rawItems = data.items
  const items = Array.isArray(rawItems)
    ? (rawItems as unknown as ReviewItem[]).filter((row) => isJsonRecordWithId(row))
    : []
  const na = data.next_after
  const next_after = na === null || na === undefined ? null : (na as Json)
  return {
    items,
    next_after,
    has_more: data.has_more === true,
  }
}

export type ReviewItemsPageRequest = {
  dataset_id: string
  limit: number
  after?: Json | null
  entity_type?: string | null
  verdict?: ReviewItem['verdict'] | null
  search?: string | null
}

export type FetchReviewItemsPageArgs = {
  datasetId: string
  limit: number
  after?: Json | null
  entityType?: string | null
  verdict?: ReviewItem['verdict'] | null
  search?: string | null
}

export type FetchReviewItemsBySampleIdsArgs = {
  datasetId: string
  sampleIds: string[]
  entityType?: string | null
  labeledOnly?: boolean
}

export type ReviewItemsPageResult = {
  items: ReviewItem[]
  next_after: Json | null
  has_more: boolean
}

export type LabeledReviewItemsPageRequest = ReviewItemsPageRequest
export type LabeledReviewItemsPageResult = ReviewItemsPageResult
export type FetchLabeledReviewItemsPageArgs = FetchReviewItemsPageArgs

export function parseSampleIdSearch(
  input: string | null | undefined,
  sourceKey: string,
): string[] {
  const prefix = sourceKey.trim()
  const seen = new Set<string>()
  const sampleIds: string[] = []

  const leadingDecorators = new Set(['[', '"', "'", '`', '('])
  const trailingDecorators = new Set([']', '"', "'", '`', ')', ','])

  for (const rawToken of (input ?? '').split(/[\s,;]+/)) {
    let token = rawToken.trim()
    while (token && leadingDecorators.has(token[0])) token = token.slice(1)
    while (token && trailingDecorators.has(token[token.length - 1])) token = token.slice(0, -1)
    if (!token) continue

    const sampleId = token.includes('#') || !prefix ? token : `${prefix}#${token}`
    if (seen.has(sampleId)) continue

    seen.add(sampleId)
    sampleIds.push(sampleId)
    if (sampleIds.length >= SAMPLE_ID_SEARCH_LIMIT) break
  }

  return sampleIds
}

function buildReviewItemsPageRequest(args: FetchReviewItemsPageArgs): ReviewItemsPageRequest {
  return {
    dataset_id: args.datasetId,
    limit: args.limit,
    after: args.after ?? null,
    entity_type: args.entityType ?? null,
    verdict: args.verdict ?? null,
    search: args.search?.trim() || null,
  }
}

export async function countReviewItemsFiltered(
  args: FetchReviewItemsPageArgs,
): Promise<DatasetReviewItemCounts> {
  const { data, error } = await supabase.rpc('count_review_items_filtered', {
    p_request: buildReviewItemsPageRequest(args) as Json,
  })
  if (error) throw error
  return parseDatasetReviewCounts(data)
}

export async function fetchReviewItemsPage(
  args: FetchReviewItemsPageArgs,
): Promise<ReviewItemsPageResult> {
  const { data, error } = await supabase.rpc('list_review_items_page_v2', {
    p_request: buildReviewItemsPageRequest(args) as Json,
  })
  if (error) throw error
  return parseListReviewItemsPagePayload(data)
}

export async function countLabeledReviewItemsFiltered(
  args: FetchLabeledReviewItemsPageArgs,
): Promise<DatasetReviewItemCounts> {
  const { data, error } = await supabase.rpc('count_labeled_review_items_filtered', {
    p_request: buildReviewItemsPageRequest(args) as Json,
  })
  if (error) throw error
  return parseDatasetReviewCounts(data)
}

export async function fetchLabeledReviewItemsPage(
  args: FetchLabeledReviewItemsPageArgs,
): Promise<LabeledReviewItemsPageResult> {
  const { data, error } = await supabase.rpc('list_labeled_review_items_page', {
    p_request: buildReviewItemsPageRequest(args) as Json,
  })
  if (error) throw error
  return parseListReviewItemsPagePayload(data)
}

function compareSampleIdSearchItems(a: ReviewItem, b: ReviewItem): number {
  const verdictDiff = (a.verdict === 'CORRECT' ? 0 : 1) - (b.verdict === 'CORRECT' ? 0 : 1)
  if (verdictDiff !== 0) return verdictDiff

  const aAuditId = a.audit_record_id ?? Number.MAX_SAFE_INTEGER
  const bAuditId = b.audit_record_id ?? Number.MAX_SAFE_INTEGER
  if (aAuditId !== bAuditId) return aAuditId - bAuditId

  return a.id.localeCompare(b.id)
}

function selectPreferredItemsBySampleId(rows: ReviewItem[], sampleIds: string[]): ReviewItem[] {
  const preferredBySampleId = new Map<string, ReviewItem>()

  for (const row of rows) {
    const current = preferredBySampleId.get(row.sample_key)
    if (!current || compareSampleIdSearchItems(row, current) < 0) {
      preferredBySampleId.set(row.sample_key, row)
    }
  }

  return sampleIds
    .map((sampleId) => preferredBySampleId.get(sampleId))
    .filter((item): item is ReviewItem => Boolean(item))
}

export async function fetchReviewItemsBySampleIds(
  args: FetchReviewItemsBySampleIdsArgs,
): Promise<ReviewItemsPageResult> {
  const sampleIds = args.sampleIds.slice(0, SAMPLE_ID_SEARCH_LIMIT)
  if (sampleIds.length === 0) {
    return { items: [], next_after: null, has_more: false }
  }

  const rows: ReviewItem[] = []

  for (let from = 0; from < sampleIds.length; from += SAMPLE_ID_SEARCH_CHUNK_SIZE) {
    const chunk = sampleIds.slice(from, from + SAMPLE_ID_SEARCH_CHUNK_SIZE)
    let query = supabase
      .from('review_items')
      .select(
        'id,dataset_id,sample_row_id,sample_key,entity_type,audit_record_id,value,start_offset,end_offset,verdict,reason,suggested_label,replacement_value,status,decision,reviewer_note,decided_by,decided_at,version,updated_at,created_at',
      )
      .eq('dataset_id', args.datasetId)
      .in('sample_key', chunk)

    if (args.entityType) query = query.eq('entity_type', args.entityType)
    if (args.labeledOnly) {
      query = query.eq('status', 'completed').not('decision', 'is', null)
    }

    const { data, error } = await query
      .order('sample_key', { ascending: true })
      .order('audit_record_id', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })

    if (error) throw error
    rows.push(...(data as ReviewItem[]))
  }

  return {
    items: selectPreferredItemsBySampleId(rows, sampleIds),
    next_after: null,
    has_more: false,
  }
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

export type SubmitDecisionResult = {
  sample: ReviewSample
  item: ReviewItem
}

export async function submitReviewDecision(
  args: SubmitDecisionArgs,
): Promise<SubmitDecisionResult> {
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
  if (
    !isJsonRecord(data) ||
    !isJsonRecordWithId(data.sample) ||
    !isJsonRecordWithId(data.item)
  ) {
    throw new Error('Invalid submit_review_decision response.')
  }

  return {
    sample: data.sample as unknown as ReviewSample,
    item: data.item as unknown as ReviewItem,
  }
}

export async function updateReviewSampleMask(args: {
  item?: ReviewItem
  sample: ReviewSample
  sourceText: string
  privacyMask: PrivacyMaskEntry[]
}): Promise<ReviewSample> {
  const { data, error } = await supabase.rpc('update_review_sample_mask', {
    p_sample_id: args.sample.id,
    p_sample_version: args.sample.version,
    p_review_item_id: args.item?.id ?? null,
    p_item_version: args.item?.version ?? null,
    p_new_privacy_mask: args.privacyMask as Json,
    p_new_source_text: args.sourceText,
  })

  if (error) throw error
  return data
}

export async function exportReviewedDataset(dataset: Dataset): Promise<JsonRecord[]> {
  // Paginate to avoid the default PostgREST 1000-row cap
  const rows: ReviewSample[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('review_samples')
      .select('*')
      .eq('dataset_id', dataset.id)
      .order('sample_index', { ascending: true })
      .range(from, from + SAMPLE_EXPORT_PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...(data as ReviewSample[]))
    if (data.length < SAMPLE_EXPORT_PAGE_SIZE) break
    from += SAMPLE_EXPORT_PAGE_SIZE
  }

  return rows.map((sample) => ({
    ...(isJsonRecord(sample.raw_output) ? sample.raw_output : {}),
    sample_id: sample.sample_key,
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
