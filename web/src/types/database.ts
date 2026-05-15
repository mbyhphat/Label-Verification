import type { AuditEvent, Dataset, Json, ReviewBundle, ReviewItem, ReviewSample } from './domain'

export type Database = {
  public: {
    Tables: {
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
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type { AuditEvent, Dataset, ReviewItem, ReviewSample }
