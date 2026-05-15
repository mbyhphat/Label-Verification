import type {
  AuditEvent,
  Dataset,
  Json,
  LabelingProject,
  PiiEntityType,
  ProjectPiiConfig,
  ProjectPiiConfigResponse,
  ProjectMember,
  ReviewBundle,
  ReviewItem,
  ReviewSample,
} from './domain'

export type Database = {
  public: {
    Tables: {
      labeling_projects: {
        Row: LabelingProject
        Insert: Partial<LabelingProject>
        Update: Partial<LabelingProject>
        Relationships: []
      }
      project_members: {
        Row: ProjectMember
        Insert: Partial<ProjectMember>
        Update: Partial<ProjectMember>
        Relationships: []
      }
      pii_entity_types: {
        Row: PiiEntityType
        Insert: Partial<PiiEntityType>
        Update: Partial<PiiEntityType>
        Relationships: []
      }
      project_pii_configs: {
        Row: ProjectPiiConfig
        Insert: Partial<ProjectPiiConfig>
        Update: Partial<ProjectPiiConfig>
        Relationships: []
      }
      datasets: {
        Row: Dataset
        Insert: Partial<Dataset>
        Update: Partial<Dataset>
        Relationships: []
      }
      review_samples: {
        Row: ReviewSample
        Insert: Partial<ReviewSample>
        Update: Partial<ReviewSample>
        Relationships: []
      }
      review_items: {
        Row: ReviewItem
        Insert: Partial<ReviewItem>
        Update: Partial<ReviewItem>
        Relationships: []
      }
      audit_events: {
        Row: AuditEvent
        Insert: Partial<AuditEvent>
        Update: Partial<AuditEvent>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      acquire_sample_lock: {
        Args: {
          p_sample_id: string
          p_expected_version: number
          p_ttl_seconds?: number
        }
        Returns: ReviewSample
      }
      release_sample_lock: {
        Args: {
          p_sample_id: string
        }
        Returns: null
      }
      open_sample: {
        Args: {
          p_sample_id: string
          p_ttl_seconds?: number
        }
        Returns: ReviewBundle
      }
      submit_review_decision: {
        Args: {
          p_review_item_id: string
          p_sample_version: number
          p_item_version: number
          p_decision: string
          p_reviewer_note?: string | null
          p_new_source_text?: string | null
          p_new_privacy_mask?: Json | null
        }
        Returns: Json
      }
      update_review_sample_mask: {
        Args: {
          p_sample_id: string
          p_sample_version: number
          p_new_privacy_mask: Json
          p_new_source_text?: string | null
        }
        Returns: ReviewSample
      }
      create_project: {
        Args: {
          p_slug: string
          p_name: string
          p_description?: string | null
        }
        Returns: LabelingProject
      }
      import_dataset_payload: {
        Args: {
          p_project_id: string
          p_manifest: Json
          p_samples: Json
          p_entities: Json
          p_replace?: boolean
        }
        Returns: Json
      }
      get_project_pii_config: {
        Args: {
          p_project_id: string
        }
        Returns: ProjectPiiConfigResponse
      }
      update_project_pii_config: {
        Args: {
          p_project_id: string
          p_required_entity_types: string[]
        }
        Returns: ProjectPiiConfigResponse
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type {
  AuditEvent,
  Dataset,
  LabelingProject,
  PiiEntityType,
  ProjectMember,
  ProjectPiiConfig,
  ReviewItem,
  ReviewSample,
}
