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
