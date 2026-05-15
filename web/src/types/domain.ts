export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json | undefined }

export type ProjectRole = 'owner' | 'admin' | 'reviewer' | 'viewer'

export type LabelingProject = {
  id: string
  slug: string
  name: string
  description: string | null
  created_by: string | null
  created_at: string
  archived_at: string | null
}

export type ProjectMember = {
  project_id: string
  user_id: string
  role: ProjectRole
  created_at: string
}

export type PiiEntityType = {
  entity_type: string
  sort_order: number
  created_at: string
}

export type ProjectPiiConfig = {
  project_id: string
  required_entity_types: string[]
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type ProjectPiiConfigResponse = {
  project_id: string
  catalog: Array<Pick<PiiEntityType, 'entity_type' | 'sort_order'>>
  required_entity_types: string[]
  required_entity_count: number
  is_default: boolean
  updated_at: string | null
}

export type Dataset = {
  id: string
  project_id: string
  source_key: string
  entity_type: string
  language: string
  folder: string | null
  metadata: Json
  created_by: string | null
  created_at: string
}

export type ReviewSample = {
  id: string
  dataset_id: string
  sample_index: number
  sample_key: string
  language: string
  original_source_text: string
  current_source_text: string
  original_privacy_mask: PrivacyMaskEntry[]
  current_privacy_mask: PrivacyMaskEntry[]
  raw_output: Json
  version: number
  locked_by: string | null
  locked_until: string | null
  updated_by: string | null
  updated_at: string
  created_at: string
}

export type ReviewItem = {
  id: string
  dataset_id: string
  sample_row_id: string
  sample_key: string
  entity_type: string
  audit_record_id: number | null
  value: string
  start_offset: number | null
  end_offset: number | null
  verdict: 'CORRECT' | 'WRONG_LABEL' | 'UNREALISTIC_VALUE'
  reason: string | null
  suggested_label: string | null
  replacement_value: string | null
  status: 'pending' | 'completed' | 'skipped'
  decision: ReviewDecision | null
  reviewer_note: string | null
  decided_by: string | null
  decided_at: string | null
  raw_audit: Json
  raw_export_span: Json
  version: number
  updated_at: string
  created_at: string
}

export type AuditEvent = {
  id: number
  project_id: string | null
  dataset_id: string | null
  sample_row_id: string | null
  review_item_id: string | null
  actor_id: string | null
  action: string
  before_state: Json | null
  after_state: Json | null
  created_at: string
}

export type ReviewDecision = 'accept' | 'deny' | 'deny_keep' | 'deny_remove'

export type PrivacyMaskEntry = {
  value?: string
  label?: string
  start?: number
  end?: number
  [key: string]: Json | undefined
}

export type ReviewBundle = {
  sample: ReviewSample
  items: ReviewItem[]
}

export type SubmitDecisionInput = {
  item: ReviewItem
  sample: ReviewSample
  decision: ReviewDecision
  reviewerNote: string
  newSourceText: string
  newPrivacyMask: PrivacyMaskEntry[]
}

export type ImportManifest = {
  schema_version?: number
  dataset?: {
    source_key?: string
    language?: string
    folder?: string | null
    sample_key_prefix?: string
  }
  files?: Json
  [key: string]: Json | undefined
}

export type ImportValidationIssue = {
  level: 'error' | 'warning'
  message: string
}

export type ImportEntitySummary = {
  entity_type: string
  audit_count: number
  export_span_count: number
  review_item_count: number
  audit_sha256?: string
  export_sha256?: string
}

export type ImportFolder = {
  rootName: string
  manifest: ImportManifest | null
  sourceKey: string | null
  language: string | null
  folder: string | null
  sampleKeyPrefix: string | null
  sampleCount: number
  samplesSha256: string | null
  entities: ImportEntitySummary[]
  files: Array<{
    path: string
    size: number
    file: File
  }>
  issues: ImportValidationIssue[]
}

export type ImportResultEntity = {
  entity_type: string
  deleted_review_items: number
  inserted_review_items: number
  payload_review_items: number
  replaced: boolean
}

export type ImportResult = {
  dataset_id: string
  dataset_created: boolean
  sample_count: number
  entities: ImportResultEntity[]
  warnings: string[]
}

export type ExistingDatasetCheck = {
  dataset: Dataset | null
  existingEntityTypes: string[]
}
