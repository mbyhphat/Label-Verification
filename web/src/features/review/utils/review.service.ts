import type {
  PrivacyMaskEntry,
  ReviewDecision,
  ReviewItem,
  ReviewSample,
} from '@/types/domain'
import { removeMaskEntry, replaceMaskLabel, replaceSourceText } from './mask-operations'

export type DecisionPreview = {
  decision: ReviewDecision
  sourceText: string
  privacyMask: PrivacyMaskEntry[]
}

export function buildDecisionPreview(
  sample: ReviewSample,
  item: ReviewItem,
  decision: ReviewDecision,
): DecisionPreview {
  if (decision === 'accept') {
    return {
      decision,
      sourceText: sample.current_source_text,
      privacyMask: sample.current_privacy_mask,
    }
  }

  if (decision === 'deny_keep') {
    return {
      decision,
      sourceText: sample.current_source_text,
      privacyMask: replaceMaskLabel(
        sample.current_privacy_mask,
        item,
        item.suggested_label || item.verdict,
      ),
    }
  }

  if (decision === 'deny_remove') {
    return {
      decision,
      sourceText: sample.current_source_text,
      privacyMask: removeMaskEntry(sample.current_privacy_mask, item),
    }
  }

  return {
    decision,
    sourceText: item.replacement_value
      ? replaceSourceText(sample.current_source_text, item, item.replacement_value)
      : sample.current_source_text,
    privacyMask: sample.current_privacy_mask,
  }
}

export function recommendedDecision(item: ReviewItem): ReviewDecision {
  if (item.verdict === 'CORRECT') return 'accept'
  if (item.verdict === 'WRONG_LABEL') return 'deny_keep'
  return 'deny_remove'
}
