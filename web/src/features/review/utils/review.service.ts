import type {
  PrivacyMaskEntry,
  ReviewDecision,
  ReviewItem,
  ReviewSample,
} from '@/types/domain'
import {
  removeMaskEntry,
  replaceMaskLabel,
  replaceSourceText,
  updateMaskAfterValueReplacement,
} from './mask-operations'

export type DecisionPreview = {
  decision: ReviewDecision
  sourceText: string
  privacyMask: PrivacyMaskEntry[]
}

/**
 * Computes the new source_text and privacy_mask that should be persisted for
 * a given (verdict × decision) combination, mirroring the logic in viewer.html.
 *
 * Truth table (matches viewer.html handleDecision):
 *   CORRECT       + accept      → no-op
 *   CORRECT       + deny        → removeMaskEntry
 *   WRONG_LABEL   + accept      → removeMaskEntry  (agree: label IS wrong → drop it)
 *   WRONG_LABEL   + deny        → no-op            (disagree: keep label as-is)
 *   WRONG_LABEL   + deny_keep   → replaceMaskLabel  (keep span, fix label – power-user path)
 *   UNREALISTIC   + accept      → replaceSourceText + updateMaskAfterValueReplacement
 *   UNREALISTIC   + deny_keep   → no-op
 *   UNREALISTIC   + deny_remove → removeMaskEntry
 */
export function buildDecisionPreview(
  sample: ReviewSample,
  item: ReviewItem,
  decision: ReviewDecision,
): DecisionPreview {
  const noOp: DecisionPreview = {
    decision,
    sourceText: sample.current_source_text,
    privacyMask: sample.current_privacy_mask,
  }

  if (item.verdict === 'CORRECT') {
    if (decision === 'accept') return noOp
    // deny → remove label (reviewer disagrees with AI's "correct" verdict)
    return {
      decision,
      sourceText: sample.current_source_text,
      privacyMask: removeMaskEntry(sample.current_privacy_mask, item),
    }
  }

  if (item.verdict === 'WRONG_LABEL') {
    if (decision === 'accept') {
      // agree label is wrong → remove the mask entry
      return {
        decision,
        sourceText: sample.current_source_text,
        privacyMask: removeMaskEntry(sample.current_privacy_mask, item),
      }
    }
    if (decision === 'deny_keep') {
      // power-user path (ReviewDetailPanel): keep span but relabel it
      return {
        decision,
        sourceText: sample.current_source_text,
        privacyMask: replaceMaskLabel(
          sample.current_privacy_mask,
          item,
          item.suggested_label || item.entity_type,
        ),
      }
    }
    // deny / deny_remove → disagree, keep label as-is
    return noOp
  }

  // UNREALISTIC_VALUE
  if (decision === 'accept') {
    if (!item.replacement_value) return noOp
    return {
      decision,
      sourceText: replaceSourceText(sample.current_source_text, item, item.replacement_value),
      privacyMask: updateMaskAfterValueReplacement(
        sample.current_privacy_mask,
        item,
        item.replacement_value,
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

  // deny_keep or deny → keep as-is
  return noOp
}

export function recommendedDecision(item: ReviewItem): ReviewDecision {
  if (item.verdict === 'CORRECT') return 'accept'
  if (item.verdict === 'WRONG_LABEL') return 'deny_keep'
  return 'deny_remove'
}
