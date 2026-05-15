import type { PrivacyMaskEntry, ReviewItem } from '@/types/domain'

function hasMatchingPosition(mask: PrivacyMaskEntry, item: ReviewItem) {
  if (item.start_offset == null || item.end_offset == null) return false
  return mask.start === item.start_offset && mask.end === item.end_offset
}

function hasMatchingValue(mask: PrivacyMaskEntry, item: ReviewItem) {
  return Boolean(item.value && mask.value === item.value)
}

export function removeMaskEntry(mask: PrivacyMaskEntry[], item: ReviewItem): PrivacyMaskEntry[] {
  return mask.filter(
    (entry) => !hasMatchingPosition(entry, item) && !hasMatchingValue(entry, item),
  )
}

export function replaceMaskLabel(
  mask: PrivacyMaskEntry[],
  item: ReviewItem,
  nextLabel: string,
): PrivacyMaskEntry[] {
  let changed = false

  const nextMask = mask.map((entry) => {
    if (hasMatchingPosition(entry, item) || hasMatchingValue(entry, item)) {
      changed = true
      return { ...entry, label: nextLabel }
    }
    return entry
  })

  if (changed) return nextMask

  return [
    ...nextMask,
    {
      value: item.value,
      label: nextLabel,
      start: item.start_offset ?? undefined,
      end: item.end_offset ?? undefined,
    },
  ]
}

export function replaceSourceText(
  sourceText: string,
  item: ReviewItem,
  replacement: string,
): string {
  if (item.start_offset == null || item.end_offset == null) {
    return sourceText.replace(item.value, replacement)
  }

  return [
    sourceText.slice(0, item.start_offset),
    replacement,
    sourceText.slice(item.end_offset),
  ].join('')
}

/**
 * For UNREALISTIC_VALUE + accept: updates the matched mask entry's value/end offset
 * and shifts all subsequent entries to account for the change in text length.
 */
export function updateMaskAfterValueReplacement(
  mask: PrivacyMaskEntry[],
  item: ReviewItem,
  replacement: string,
): PrivacyMaskEntry[] {
  if (item.start_offset == null || item.end_offset == null) return mask

  const start = item.start_offset
  const end = item.end_offset
  const delta = replacement.length - (end - start)

  let matched = false

  return mask.map((entry) => {
    if (!matched && hasMatchingPosition(entry, item)) {
      matched = true
      return { ...entry, value: replacement, end: start + replacement.length }
    }
    if (entry.start != null && entry.start > start) {
      return {
        ...entry,
        start: (entry.start as number) + delta,
        end: entry.end != null ? (entry.end as number) + delta : entry.end,
      }
    }
    return entry
  })
}
