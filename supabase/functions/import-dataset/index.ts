/// <reference path="./supabase-js.d.ts" />
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from '@supabase/supabase-js'

type JsonObject = Record<string, unknown>

type ImportFile = {
  path: string
  file: File
  json?: unknown
  sha256?: string
}

type SampleRef = {
  prefix: string
  index: number
}

type SampleLookupRow = {
  sample_index: number
  sample_key: string
}

type ReviewRow = {
  sample_index: number
  audit_record_id: number | null
  value: string
  start_offset: number | null
  end_offset: number | null
  verdict: string
  reason: string | null
  suggested_label: string | null
  replacement_value: string | null
  raw_audit: JsonObject
  raw_export_span: JsonObject
}

type EntityPayload = {
  entity_type: string
  audit_results: JsonObject[]
  export_spans: JsonObject[]
  review_rows: ReviewRow[]
}

const VALID_VERDICTS = new Set(['CORRECT', 'WRONG_LABEL', 'UNREALISTIC_VALUE'])
const SAMPLE_REF_RE = /^(?<prefix>.+)#(?<index>\d+)$/

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

class ImportValidationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'method_not_allowed', message: 'Use POST.' } }, 405)
  }

  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) {
      throw new ImportValidationError('Missing bearer token.', 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase function environment is missing SUPABASE_URL or anon key.')
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new ImportValidationError('Invalid or expired session.', 401)
    }

    const formData = await req.formData()
    const projectId = stringField(formData, 'projectId')
    if (!projectId) {
      throw new ImportValidationError('Missing projectId.')
    }

    const replace = booleanField(formData, 'replace')
    const files = formData
      .getAll('files')
      .filter((entry): entry is File => typeof entry === 'object' && entry !== null && 'arrayBuffer' in entry)
    const paths = parsePathsField(formData, files.length)

    if (files.length === 0) {
      throw new ImportValidationError('No files were uploaded.')
    }

    const plan = await buildImportPayload(files, paths)

    const { data, error } = await supabase.rpc('import_dataset_payload', {
      p_project_id: projectId,
      p_manifest: plan.manifest,
      p_samples: plan.samples,
      p_entities: plan.entities.map((entity) => ({
        entity_type: entity.entity_type,
        review_rows: entity.review_rows,
      })),
      p_replace: replace,
    })

    if (error) {
      const message = error.message || 'Import failed.'
      const status = isConflictMessage(message) ? 409 : 422
      return jsonResponse(
        {
          error: {
            code: 'import_failed',
            message,
            details: error,
          },
        },
        status,
      )
    }

    return jsonResponse({
      data: {
        ...asObject(data),
        warnings: [...plan.warnings, ...jsonStringArray(asObject(data).warnings)],
      },
      preview: plan.preview,
    })
  } catch (err) {
    const status = err instanceof ImportValidationError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Unexpected import error.'
    return jsonResponse(
      {
        error: {
          code: status >= 500 ? 'server_error' : 'validation_error',
          message,
        },
      },
      status,
    )
  }
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function stringField(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function booleanField(formData: FormData, key: string): boolean {
  return stringField(formData, key) === 'true'
}

function parsePathsField(formData: FormData, expectedLength: number): string[] | null {
  const raw = stringField(formData, 'paths')
  if (!raw) return null
  try {
    const paths = JSON.parse(raw)
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) return null
    return paths.length === expectedLength ? paths : null
  } catch {
    return null
  }
}

function isConflictMessage(message: string): boolean {
  return [
    'entity_import_exists',
    'samples_changed',
    'sample_count_changed',
    'project_slug_exists',
  ].some((needle) => message.includes(needle))
}

async function buildImportPayload(files: File[], paths: string[] | null): Promise<{
  manifest: JsonObject
  samples: JsonObject[]
  entities: EntityPayload[]
  warnings: string[]
  preview: JsonObject
}> {
  const fileMap = normalizeUploadedFiles(files, paths)
  const manifestFile = fileMap.get('manifest.json')
  const samplesFile = fileMap.get('samples.json')

  if (!manifestFile) {
    throw new ImportValidationError('Missing manifest.json at the upload root.')
  }
  if (!samplesFile) {
    throw new ImportValidationError('Missing samples.json at the upload root.')
  }

  const manifest = asObject(await readJson(manifestFile))
  const samplesJson = await readJson(samplesFile)
  const samples = normalizeOutputSamples(samplesJson)
  const samplesSha256 = await sha256File(samplesFile.file)

  const entityFiles = discoverEntityFiles(fileMap)
  if (entityFiles.length === 0) {
    throw new ImportValidationError('No entities/<ENTITY>/audit.json files were found.')
  }

  const entities: EntityPayload[] = []
  const warnings: string[] = []

  let firstLanguage: string | null = null
  let firstPrefix: string | null = null

  for (const entityFile of entityFiles) {
    const auditJson = await readJson(entityFile.audit)
    const exportJson = await readJson(entityFile.exportFile)
    const auditResults = normalizeAuditResults(auditJson)
    const exportSpans = normalizeExportSpans(exportJson)
    const exportObject = asObject(exportJson)
    const entityType = entityFile.entityType || stringValue(exportObject.type)

    if (!entityType) {
      throw new ImportValidationError(`Could not infer entity type for ${entityFile.audit.path}.`)
    }

    const language =
      firstLanguage ??
      stringValue(asObject(manifest.dataset).language) ??
      stringValue(manifest.language) ??
      stringValue(exportObject.language) ??
      firstNonempty(samples.map((sample) => sample.language))

    if (!language) {
      throw new ImportValidationError('Could not infer dataset language.')
    }
    firstLanguage = language

    const sampleKeyPrefix =
      firstPrefix ??
      stringValue(asObject(manifest.dataset).sample_key_prefix) ??
      stringValue(manifest.sample_key_prefix) ??
      stringValue(asObject(manifest.dataset).source_key) ??
      stringValue(manifest.source_key) ??
      inferSampleKeyPrefix(auditResults, exportSpans, language, 'samples')

    firstPrefix = sampleKeyPrefix

    const sampleLookup = buildSampleLookup(samples, sampleKeyPrefix)
    const [reviewRows, reviewWarnings] = buildReviewRows(
      auditResults,
      exportSpans,
      entityType,
      sampleLookup,
    )
    const [dedupedRows, dedupeWarnings] = dedupeReviewRows(reviewRows)

    warnings.push(...reviewWarnings.map((warning) => `${entityType}: ${warning}`))
    warnings.push(...dedupeWarnings.map((warning) => `${entityType}: ${warning}`))

    const auditSha256 = await sha256File(entityFile.audit.file)
    const exportSha256 = await sha256File(entityFile.exportFile.file)

    entities.push({
      entity_type: entityType,
      audit_results: auditResults,
      export_spans: exportSpans,
      review_rows: dedupedRows,
    })

    const nextFiles = asObject(manifest.files)
    const nextEntityFiles = asObject(nextFiles.entities)
    nextEntityFiles[entityType] = {
      audit_sha256: auditSha256,
      export_sha256: exportSha256,
      audit_count: auditResults.length,
      export_span_count: exportSpans.length,
      review_item_count: dedupedRows.length,
    }
    nextFiles.entities = nextEntityFiles
    manifest.files = nextFiles
  }

  const dataset = asObject(manifest.dataset)
  dataset.language = stringValue(dataset.language) ?? firstLanguage
  dataset.sample_key_prefix = stringValue(dataset.sample_key_prefix) ?? firstPrefix
  dataset.source_key = stringValue(dataset.source_key) ?? dataset.sample_key_prefix
  dataset.folder = stringValue(dataset.folder) ?? null

  if (!dataset.source_key || !dataset.language || !dataset.sample_key_prefix) {
    throw new ImportValidationError('Manifest must resolve source_key, language, and sample_key_prefix.')
  }

  manifest.schema_version = manifest.schema_version ?? 1
  manifest.dataset = dataset
  manifest.files = {
    ...asObject(manifest.files),
    samples_sha256: samplesSha256,
  }
  manifest.generated_by = 'pii_verification/supabase/functions/import-dataset'

  return {
    manifest,
    samples,
    entities,
    warnings,
    preview: {
      source_key: dataset.source_key,
      language: dataset.language,
      folder: dataset.folder,
      sample_key_prefix: dataset.sample_key_prefix,
      sample_count: samples.length,
      entity_count: entities.length,
      review_item_count: entities.reduce((total, entity) => total + entity.review_rows.length, 0),
      entities: entities.map((entity) => ({
        entity_type: entity.entity_type,
        audit_count: entity.audit_results.length,
        export_span_count: entity.export_spans.length,
        review_item_count: entity.review_rows.length,
      })),
      warnings,
    },
  }
}

function normalizeUploadedFiles(files: File[], paths: string[] | null): Map<string, ImportFile> {
  const uploads = files.map((file, index) => ({
    path: normalizePath(paths?.[index] ?? file.name),
    file,
  }))

  const manifest = uploads
    .filter((upload) => upload.path.split('/').at(-1) === 'manifest.json')
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0]

  const rootParts = manifest ? manifest.path.split('/').slice(0, -1) : []
  const result = new Map<string, ImportFile>()

  for (const upload of uploads) {
    const parts = upload.path.split('/')
    const stripped = startsWithParts(parts, rootParts) ? parts.slice(rootParts.length).join('/') : upload.path
    if (stripped && stripped.endsWith('.json')) {
      result.set(stripped, { ...upload, path: stripped })
    }
  }

  return result
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function startsWithParts(parts: string[], prefix: string[]): boolean {
  return prefix.every((part, index) => parts[index] === part)
}

async function readJson(upload: ImportFile): Promise<unknown> {
  if (upload.json !== undefined) return upload.json
  try {
    upload.json = JSON.parse(await upload.file.text())
    return upload.json
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON.'
    throw new ImportValidationError(`${upload.path}: ${message}`)
  }
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function discoverEntityFiles(fileMap: Map<string, ImportFile>): Array<{
  entityType: string
  audit: ImportFile
  exportFile: ImportFile
}> {
  const result = []
  for (const [path, audit] of fileMap.entries()) {
    const parts = path.split('/')
    if (parts.length === 3 && parts[0] === 'entities' && parts[2] === 'audit.json') {
      const exportFile = fileMap.get(`entities/${parts[1]}/export.json`)
      if (!exportFile) {
        throw new ImportValidationError(`Missing entities/${parts[1]}/export.json.`)
      }
      result.push({ entityType: parts[1], audit, exportFile })
    }
  }
  return result.sort((a, b) => a.entityType.localeCompare(b.entityType))
}

function normalizeOutputSamples(payload: unknown): JsonObject[] {
  const samples = Array.isArray(payload)
    ? payload
    : Array.isArray(asObject(payload).samples)
      ? asObject(payload).samples
      : Array.isArray(asObject(payload).data)
        ? asObject(payload).data
        : null

  if (!samples) {
    throw new ImportValidationError('samples.json must be a list or contain a samples/data list.')
  }

  return samples.map((sample, index) => {
    const object = asObject(sample)
    if (typeof object.source_text !== 'string') {
      throw new ImportValidationError(`samples.json sample ${index} is missing source_text.`)
    }
    if (object.privacy_mask !== undefined && !Array.isArray(object.privacy_mask)) {
      throw new ImportValidationError(`samples.json sample ${index} has non-list privacy_mask.`)
    }
    return object
  })
}

function normalizeAuditResults(payload: unknown): JsonObject[] {
  const results = Array.isArray(payload)
    ? payload
    : Array.isArray(asObject(payload).results)
      ? asObject(payload).results
      : null

  if (!results) {
    throw new ImportValidationError('audit.json must be a list or contain a results list.')
  }

  return results.map((item, index) => {
    const object = asObject(item)
    if (!object.sample_id) {
      throw new ImportValidationError(`audit.json result ${index} is missing sample_id.`)
    }
    if (object.value === undefined || object.value === null) {
      throw new ImportValidationError(`audit.json result ${index} is missing value.`)
    }
    if (!VALID_VERDICTS.has(String(object.verdict))) {
      throw new ImportValidationError(`audit.json result ${index} has invalid verdict.`)
    }
    return object
  })
}

function normalizeExportSpans(payload: unknown): JsonObject[] {
  const samples = asObject(payload).samples
  if (samples === undefined) return []
  if (!Array.isArray(samples)) {
    throw new ImportValidationError("export.json 'samples' must be a list.")
  }
  return samples.filter((span): span is JsonObject => isObject(span))
}

function inferSampleKeyPrefix(
  auditResults: JsonObject[],
  exportSpans: JsonObject[],
  language: string,
  outputStem: string,
): string {
  const prefixes = [...auditResults, ...exportSpans]
    .map((row) => parseSampleRef(String(row.sample_id ?? ''))?.prefix)
    .filter((prefix): prefix is string => Boolean(prefix))

  if (prefixes.length === 0) return `${language}/${outputStem}`
  const counts = new Map<string, number>()
  for (const prefix of prefixes) counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function buildSampleLookup(samples: JsonObject[], sampleKeyPrefix: string): {
  byKey: Map<string, SampleLookupRow>
  byIndex: Map<number, SampleLookupRow>
} {
  const byKey = new Map<string, SampleLookupRow>()
  const byIndex = new Map<number, SampleLookupRow>()
  samples.forEach((_sample, index) => {
    const row = {
      sample_index: index,
      sample_key: `${sampleKeyPrefix}#${index}`,
    }
    byKey.set(row.sample_key, row)
    byIndex.set(index, row)
  })
  return { byKey, byIndex }
}

function buildReviewRows(
  auditResults: JsonObject[],
  exportSpans: JsonObject[],
  entityType: string,
  sampleLookup: ReturnType<typeof buildSampleLookup>,
): [ReviewRow[], string[]] {
  const spanLookup = buildSpanLookup(exportSpans)
  const spanUsage = new Map<string, number>()
  const warnings: string[] = []
  let missingSpans = 0

  const reviewRows = auditResults.map((item, index) => {
    const sample = resolveSampleForItem(item, sampleLookup)
    if (!sample) {
      throw new ImportValidationError(
        `Audit result ${index} references missing sample_id ${String(item.sample_id ?? '')}.`,
      )
    }

    const span = findMatchingSpan(item, spanLookup, spanUsage)
    if (!span) missingSpans += 1

    return {
      sample_index: sample.sample_index,
      audit_record_id: intOrNull(item.id),
      value: String(item.value),
      start_offset: pickFirstInt(asObject(span).start, item.start),
      end_offset: pickFirstInt(asObject(span).end, item.end),
      verdict: String(item.verdict),
      reason: stringValue(item.reason),
      suggested_label: stringValue(item.suggested_label),
      replacement_value: stringValue(item.replacement_value),
      raw_audit: item,
      raw_export_span: asObject(span),
    }
  })

  if (missingSpans > 0) {
    warnings.push(`${missingSpans} review items had no matching export span.`)
  }

  void entityType
  return [reviewRows, warnings]
}

function buildSpanLookup(exportSpans: JsonObject[]) {
  const bySampleIdIdValue = new Map<string, JsonObject[]>()
  const byIdValue = new Map<string, JsonObject[]>()
  const bySampleIndexIdValue = new Map<string, JsonObject[]>()

  for (const span of exportSpans) {
    const sampleId = String(span.sample_id ?? '')
    const auditId = comparableId(span.id)
    const value = span.value
    pushMapList(bySampleIdIdValue, key([sampleId, auditId, value]), span)
    pushMapList(byIdValue, key([auditId, value]), span)

    const ref = parseSampleRef(sampleId)
    if (ref) pushMapList(bySampleIndexIdValue, key([ref.index, auditId, value]), span)
  }

  for (const bucket of [bySampleIdIdValue, byIdValue, bySampleIndexIdValue]) {
    for (const spans of bucket.values()) spans.sort(spanSortKey)
  }

  return { bySampleIdIdValue, byIdValue, bySampleIndexIdValue }
}

function findMatchingSpan(
  item: JsonObject,
  spanLookup: ReturnType<typeof buildSpanLookup>,
  spanUsage: Map<string, number>,
): JsonObject | null {
  const sampleId = String(item.sample_id ?? '')
  const auditId = comparableId(item.id)
  const value = item.value

  const directKey = key([sampleId, auditId, value])
  const direct = spanLookup.bySampleIdIdValue.get(directKey)
  if (direct) return pickMatchingSpan(item, direct, `direct:${directKey}`, spanUsage)

  const ref = parseSampleRef(sampleId)
  if (ref) {
    const indexKey = key([ref.index, auditId, value])
    const indexed = spanLookup.bySampleIndexIdValue.get(indexKey)
    if (indexed) return pickMatchingSpan(item, indexed, `index:${indexKey}`, spanUsage)
  }

  const looseKey = key([auditId, value])
  const loose = spanLookup.byIdValue.get(looseKey)
  if (loose) return pickMatchingSpan(item, loose, `loose:${looseKey}`, spanUsage)

  return null
}

function pickMatchingSpan(
  item: JsonObject,
  candidates: JsonObject[],
  usageKey: string,
  spanUsage: Map<string, number>,
): JsonObject | null {
  const itemStart = intOrNull(item.start)
  const itemEnd = intOrNull(item.end)
  if (itemStart !== null || itemEnd !== null) {
    return (
      candidates.find((span) => {
        const start = intOrNull(span.start)
        const end = intOrNull(span.end)
        return (itemStart === null || itemStart === start) && (itemEnd === null || itemEnd === end)
      }) ?? null
    )
  }

  const index = spanUsage.get(usageKey) ?? 0
  spanUsage.set(usageKey, index + 1)
  return candidates[index] ?? null
}

function resolveSampleForItem(
  item: JsonObject,
  sampleLookup: ReturnType<typeof buildSampleLookup>,
): SampleLookupRow | null {
  const sampleId = String(item.sample_id ?? '')
  const byKey = sampleLookup.byKey.get(sampleId)
  if (byKey) return byKey
  const ref = parseSampleRef(sampleId)
  return ref ? sampleLookup.byIndex.get(ref.index) ?? null : null
}

function dedupeReviewRows(rows: ReviewRow[]): [ReviewRow[], string[]] {
  const seen = new Set<string>()
  const deduped: ReviewRow[] = []
  let duplicateCount = 0

  for (const row of rows) {
    const rowKey = key([
      row.sample_index,
      row.audit_record_id,
      row.value,
      row.start_offset ?? -1,
      row.end_offset ?? -1,
    ])
    if (seen.has(rowKey)) {
      duplicateCount += 1
      continue
    }
    seen.add(rowKey)
    deduped.push(row)
  }

  return duplicateCount > 0
    ? [deduped, [`Skipped ${duplicateCount} duplicate review items.`]]
    : [deduped, []]
}

function parseSampleRef(sampleId: string): SampleRef | null {
  const match = SAMPLE_REF_RE.exec(sampleId)
  if (!match?.groups) return null
  return {
    prefix: match.groups.prefix,
    index: Number(match.groups.index),
  }
}

function spanSortKey(a: JsonObject, b: JsonObject): number {
  const aRef = parseSampleRef(String(a.sample_id ?? ''))
  const bRef = parseSampleRef(String(b.sample_id ?? ''))
  return (
    (aRef?.index ?? Number.MAX_SAFE_INTEGER) - (bRef?.index ?? Number.MAX_SAFE_INTEGER) ||
    (intOrNull(a.start) ?? Number.MAX_SAFE_INTEGER) - (intOrNull(b.start) ?? Number.MAX_SAFE_INTEGER) ||
    (intOrNull(a.end) ?? Number.MAX_SAFE_INTEGER) - (intOrNull(b.end) ?? Number.MAX_SAFE_INTEGER)
  )
}

function pushMapList(map: Map<string, JsonObject[]>, mapKey: string, value: JsonObject): void {
  const list = map.get(mapKey) ?? []
  list.push(value)
  map.set(mapKey, list)
}

function key(parts: unknown[]): string {
  return JSON.stringify(parts)
}

function comparableId(value: unknown): unknown {
  return intOrNull(value) ?? value
}

function pickFirstInt(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = intOrNull(value)
    if (parsed !== null) return parsed
  }
  return null
}

function intOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstNonempty(values: unknown[]): string | null {
  for (const value of values) {
    const next = stringValue(value)
    if (next) return next
  }
  return null
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {}
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
