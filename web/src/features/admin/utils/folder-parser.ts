import type {
  ImportEntitySummary,
  ImportFolder,
  ImportManifest,
  ImportValidationIssue,
} from '@/types/domain'

type UploadFile = {
  path: string
  size: number
  file: File
}

type JsonObject = Record<string, unknown>

const SAMPLE_REF_RE = /^(?<prefix>.+)#(?<index>\d+)$/

export async function parseFolderUpload(fileList: FileList | File[]): Promise<ImportFolder> {
  const files = normalizeFiles(Array.from(fileList))
  const issues: ImportValidationIssue[] = []
  const fileMap = new Map(files.map((file) => [file.path, file]))
  const manifestFile = fileMap.get('manifest.json')
  const samplesFile = fileMap.get('samples.json')

  let manifest: ImportManifest | null = null
  let samples: JsonObject[] = []
  let samplesSha256: string | null = null

  if (!manifestFile) {
    issues.push({ level: 'error', message: 'Missing manifest.json at the upload root.' })
  } else {
    try {
      manifest = asObject(await readJson(manifestFile)) as ImportManifest
    } catch (error) {
      issues.push({ level: 'error', message: messageFor(error, 'manifest.json is invalid.') })
    }
  }

  if (!samplesFile) {
    issues.push({ level: 'error', message: 'Missing samples.json at the upload root.' })
  } else {
    try {
      samples = normalizeSamples(await readJson(samplesFile))
      samplesSha256 = await sha256File(samplesFile.file)
    } catch (error) {
      issues.push({ level: 'error', message: messageFor(error, 'samples.json is invalid.') })
    }
  }

  const entities = await parseEntities(fileMap, issues)
  const firstEntity = entities.find((entity) => entity.sampleKeyPrefix)
  const manifestDataset = asObject(manifest?.dataset)
  const sourceKey =
    stringValue(manifestDataset.source_key) ??
    stringValue(manifest?.source_key) ??
    firstEntity?.sampleKeyPrefix ??
    null
  const language =
    stringValue(manifestDataset.language) ??
    stringValue(manifest?.language) ??
    firstEntity?.language ??
    firstNonempty(samples.map((sample) => sample.language))
  const sampleKeyPrefix =
    stringValue(manifestDataset.sample_key_prefix) ??
    stringValue(manifest?.sample_key_prefix) ??
    sourceKey
  const folder = stringValue(manifestDataset.folder) ?? stringValue(manifest?.folder)

  if (!sourceKey) issues.push({ level: 'error', message: 'Could not infer dataset source_key.' })
  if (!language) issues.push({ level: 'error', message: 'Could not infer dataset language.' })
  if (!sampleKeyPrefix) {
    issues.push({ level: 'error', message: 'Could not infer sample_key_prefix.' })
  }
  if (entities.length === 0) {
    issues.push({ level: 'error', message: 'No entities/<ENTITY>/audit.json files were found.' })
  }
  if (!manifest?.schema_version) {
    issues.push({ level: 'warning', message: 'manifest.json has no schema_version; v1 will be used.' })
  }

  return {
    rootName: inferRootName(Array.from(fileList)),
    manifest,
    sourceKey,
    language,
    folder,
    sampleKeyPrefix,
    sampleCount: samples.length,
    samplesSha256,
    entities: entities.map((entity) => ({
      entity_type: entity.entity_type,
      audit_count: entity.audit_count,
      export_span_count: entity.export_span_count,
      review_item_count: entity.review_item_count,
      audit_sha256: entity.audit_sha256,
      export_sha256: entity.export_sha256,
    })),
    files,
    issues,
  }
}

function normalizeFiles(files: File[]): UploadFile[] {
  const uploads = files
    .filter((file) => file.name.endsWith('.json') || getRelativePath(file).endsWith('.json'))
    .map((file) => ({
      path: normalizePath(getRelativePath(file)),
      size: file.size,
      file,
    }))

  const manifest = uploads
    .filter((upload) => upload.path.split('/').at(-1) === 'manifest.json')
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0]
  const rootParts = manifest ? manifest.path.split('/').slice(0, -1) : []

  return uploads
    .map((upload) => {
      const parts = upload.path.split('/')
      const stripped = startsWithParts(parts, rootParts)
        ? parts.slice(rootParts.length).join('/')
        : upload.path
      return { ...upload, path: stripped }
    })
    .filter((upload) => upload.path.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path))
}

async function parseEntities(
  fileMap: Map<string, UploadFile>,
  issues: ImportValidationIssue[],
): Promise<Array<ImportEntitySummary & { language: string | null; sampleKeyPrefix: string | null }>> {
  const entities: Array<ImportEntitySummary & { language: string | null; sampleKeyPrefix: string | null }> = []

  for (const [path, auditFile] of fileMap.entries()) {
    const parts = path.split('/')
    if (parts.length !== 3 || parts[0] !== 'entities' || parts[2] !== 'audit.json') continue

    const entityType = parts[1]
    const exportFile = fileMap.get(`entities/${entityType}/export.json`)
    if (!exportFile) {
      issues.push({ level: 'error', message: `Missing entities/${entityType}/export.json.` })
      continue
    }

    try {
      const [auditJson, exportJson, auditSha256, exportSha256] = await Promise.all([
        readJson(auditFile),
        readJson(exportFile),
        sha256File(auditFile.file),
        sha256File(exportFile.file),
      ])
      const auditResults = normalizeAuditResults(auditJson)
      const exportObject = asObject(exportJson)
      const exportSpans = Array.isArray(exportObject.samples) ? exportObject.samples : []
      const language = stringValue(exportObject.language)
      const sampleKeyPrefix = inferSampleKeyPrefix(auditResults, exportSpans, language ?? 'en')

      entities.push({
        entity_type: entityType,
        audit_count: auditResults.length,
        export_span_count: exportSpans.length,
        review_item_count: auditResults.length,
        audit_sha256: auditSha256,
        export_sha256: exportSha256,
        language,
        sampleKeyPrefix,
      })
    } catch (error) {
      issues.push({
        level: 'error',
        message: messageFor(error, `Could not parse ${entityType} files.`),
      })
    }
  }

  return entities.sort((a, b) => a.entity_type.localeCompare(b.entity_type))
}

async function readJson(upload: UploadFile): Promise<unknown> {
  try {
    return JSON.parse(await upload.file.text())
  } catch (error) {
    throw new Error(`${upload.path}: ${messageFor(error, 'Invalid JSON.')}`, { cause: error })
  }
}

function normalizeSamples(payload: unknown): JsonObject[] {
  const object = asObject(payload)
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(object.samples)
      ? object.samples
      : Array.isArray(object.data)
        ? object.data
        : null

  if (!rows) throw new Error('samples.json must be a list or contain samples/data.')

  return rows.map((row, index) => {
    const sample = asObject(row)
    if (typeof sample.source_text !== 'string') {
      throw new Error(`samples.json sample ${index} is missing source_text.`)
    }
    if (sample.privacy_mask !== undefined && !Array.isArray(sample.privacy_mask)) {
      throw new Error(`samples.json sample ${index} has non-list privacy_mask.`)
    }
    return sample
  })
}

function normalizeAuditResults(payload: unknown): JsonObject[] {
  const object = asObject(payload)
  const rows = Array.isArray(payload) ? payload : Array.isArray(object.results) ? object.results : null
  if (!rows) throw new Error('audit.json must be a list or contain results.')

  return rows.map((row, index) => {
    const item = asObject(row)
    if (!item.sample_id) throw new Error(`audit.json result ${index} is missing sample_id.`)
    if (item.value === undefined || item.value === null) {
      throw new Error(`audit.json result ${index} is missing value.`)
    }
    return item
  })
}

function inferSampleKeyPrefix(
  auditResults: JsonObject[],
  exportSpans: unknown[],
  fallbackLanguage: string,
): string {
  const prefixes = [...auditResults, ...exportSpans.map(asObject)]
    .map((row) => parseSampleRef(String(row.sample_id ?? ''))?.prefix)
    .filter((prefix): prefix is string => Boolean(prefix))

  if (prefixes.length === 0) return `${fallbackLanguage}/samples`

  const counts = new Map<string, number>()
  for (const prefix of prefixes) counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function parseSampleRef(sampleId: string): { prefix: string; index: number } | null {
  const match = SAMPLE_REF_RE.exec(sampleId)
  if (!match?.groups) return null
  return { prefix: match.groups.prefix, index: Number(match.groups.index) }
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function getRelativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

function inferRootName(files: File[]): string {
  const firstPath = files.map(getRelativePath).find((path) => path.includes('/'))
  return firstPath?.split('/')[0] ?? 'selected-folder'
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function startsWithParts(parts: string[], prefix: string[]): boolean {
  return prefix.every((part, index) => parts[index] === part)
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
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

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
