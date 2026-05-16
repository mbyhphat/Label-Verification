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

type DecisionPreviewOptions = {
  projectLabels?: string[]
}

function getAllowedProjectLabel(
  label: string | null | undefined,
  projectLabels: string[],
): string | null {
  if (!label) return null
  const normalizedLabel = label.trim().toUpperCase()
  return projectLabels.includes(normalizedLabel) ? normalizedLabel : null
}

/**
 * Computes the new source_text and privacy_mask that should be persisted for
 * a given (verdict × decision) combination, mirroring the logic in viewer.html.
 *
 * Truth table (matches viewer.html handleDecision):
 *   CORRECT       + accept      → no-op
 *   CORRECT       + deny        → removeMaskEntry
 *   WRONG_LABEL   + accept      → relabel to suggested label if it is project-allowed;
 *                                  otherwise removeMaskEntry
 *   WRONG_LABEL   + deny        → no-op            (disagree: keep label as-is)
 *   WRONG_LABEL   + deny_remove → removeMaskEntry  (value is not PII)
 *   UNREALISTIC   + accept      → replaceSourceText + updateMaskAfterValueReplacement
 *   UNREALISTIC   + deny_keep   → no-op
 *   UNREALISTIC   + deny_remove → removeMaskEntry
 */
export function buildDecisionPreview(
  sample: ReviewSample,
  item: ReviewItem,
  decision: ReviewDecision,
  options: DecisionPreviewOptions = {},
): DecisionPreview {
  const projectLabels = options.projectLabels ?? []
  const suggestedLabel = getAllowedProjectLabel(item.suggested_label, projectLabels)

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
      if (suggestedLabel) {
        return {
          decision,
          sourceText: sample.current_source_text,
          privacyMask: replaceMaskLabel(sample.current_privacy_mask, item, suggestedLabel),
        }
      }

      // Agree the current label is wrong, but no project-allowed replacement exists.
      return {
        decision,
        sourceText: sample.current_source_text,
        privacyMask: removeMaskEntry(sample.current_privacy_mask, item),
      }
    }
    if (decision === 'deny_remove') {
      return {
        decision,
        sourceText: sample.current_source_text,
        privacyMask: removeMaskEntry(sample.current_privacy_mask, item),
      }
    }
    // deny / deny_keep → keep the current PII span as-is.
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

export function recommendedDecision(
  item: ReviewItem,
  projectLabels: string[] = [],
): ReviewDecision {
  if (item.verdict === 'CORRECT') return 'accept'
  if (item.verdict === 'WRONG_LABEL') {
    return getAllowedProjectLabel(item.suggested_label, projectLabels) ? 'accept' : 'deny_remove'
  }
  return 'deny_remove'
}
