import type { PrivacyMaskEntry, ReviewItem } from '@/types/domain'

const HIGHLIGHT_SELECTOR = '[data-review-highlight="true"]'

type HighlightRange = {
  start: number
  end: number
}

type HighlightSegment = HighlightRange & {
  label: string
  role: 'target' | 'related'
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttribute(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#39;')
}

function isValidRange(sourceText: string, start: number | undefined, end: number | undefined) {
  return (
    start != null &&
    end != null &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= sourceText.length
  )
}

function rangesOverlap(a: HighlightRange, b: HighlightRange): boolean {
  return a.start < b.end && b.start < a.end
}

function overlapsAny(range: HighlightRange, ranges: HighlightRange[]): boolean {
  return ranges.some((existing) => rangesOverlap(range, existing))
}

function findHighlightRange(
  sourceText: string,
  item: ReviewItem,
): HighlightRange | null {
  const { start_offset: start, end_offset: end, value } = item

  if (isValidRange(sourceText, start ?? undefined, end ?? undefined)) {
    return { start: start as number, end: end as number }
  }

  if (!value) return null

  const idx = sourceText.indexOf(value)
  if (idx === -1) return null

  return { start: idx, end: idx + value.length }
}

function findValueRange(
  sourceText: string,
  value: string | undefined,
  occupiedRanges: HighlightRange[],
): HighlightRange | null {
  if (!value) return null

  let searchFrom = 0
  while (searchFrom < sourceText.length) {
    const idx = sourceText.indexOf(value, searchFrom)
    if (idx === -1) return null

    const range = { start: idx, end: idx + value.length }
    if (!overlapsAny(range, occupiedRanges)) return range

    searchFrom = idx + Math.max(value.length, 1)
  }

  return null
}

function findMaskRange(
  sourceText: string,
  entry: PrivacyMaskEntry,
  occupiedRanges: HighlightRange[],
): HighlightRange | null {
  if (isValidRange(sourceText, entry.start, entry.end)) {
    const range = { start: entry.start as number, end: entry.end as number }
    const valueMatches = !entry.value || sourceText.slice(range.start, range.end) === entry.value

    if (overlapsAny(range, occupiedRanges)) return null
    if (valueMatches) return range
  }

  return findValueRange(sourceText, entry.value, occupiedRanges)
}

function renderMarkedText(sourceText: string, segment: HighlightSegment): string {
  const text = sourceText.slice(segment.start, segment.end)
  const label = escapeAttribute(segment.label)
  const value = escapeAttribute(text)
  const classes =
    segment.role === 'target'
      ? 'review-entity-mark review-entity-mark--target'
      : 'review-entity-mark review-entity-mark--related'

  return (
    `<mark class="${classes}" data-review-highlight="${segment.role === 'target'}"` +
    ` data-review-label="${label}" title="${label}" aria-label="${value}, ${label}">` +
    escapeHtml(text) +
    '</mark>'
  )
}

function buildHighlightSegments(
  sourceText: string,
  item: ReviewItem,
  privacyMask: PrivacyMaskEntry[],
): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  const occupiedRanges: HighlightRange[] = []
  const targetRange = findHighlightRange(sourceText, item)

  if (targetRange) {
    segments.push({
      ...targetRange,
      label: item.entity_type,
      role: 'target',
    })
    occupiedRanges.push(targetRange)
  }

  for (const entry of privacyMask) {
    if (!entry.label) continue

    const range = findMaskRange(sourceText, entry, occupiedRanges)
    if (!range) continue

    segments.push({
      ...range,
      label: entry.label,
      role: 'related',
    })
    occupiedRanges.push(range)
  }

  return segments.sort((a, b) => a.start - b.start || b.end - a.end)
}

export function buildHighlightedSourceHtml(
  sourceText: string,
  item: ReviewItem,
  privacyMask: PrivacyMaskEntry[] = [],
): string {
  const segments = buildHighlightSegments(sourceText, item, privacyMask)

  if (segments.length === 0) return escapeHtml(sourceText)

  let cursor = 0
  let html = ''

  for (const segment of segments) {
    html += escapeHtml(sourceText.slice(cursor, segment.start))
    html += renderMarkedText(sourceText, segment)
    cursor = segment.end
  }

  html += escapeHtml(sourceText.slice(cursor))
  return html
}

export function scrollHighlightedTextIntoView(container: HTMLElement | null): (() => void) | undefined {
  if (!container || typeof window === 'undefined') return undefined

  const frame = window.requestAnimationFrame(() => {
    const mark = container.querySelector<HTMLElement>(HIGHLIGHT_SELECTOR)
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    mark?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  })

  return () => window.cancelAnimationFrame(frame)
}
