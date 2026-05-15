import type { ReviewItem } from '@/types/domain'

const HIGHLIGHT_SELECTOR = '[data-review-highlight="true"]'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function findHighlightRange(
  sourceText: string,
  item: ReviewItem,
): { start: number; end: number } | null {
  const { start_offset: start, end_offset: end, value } = item

  if (
    start != null &&
    end != null &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= sourceText.length
  ) {
    return { start, end }
  }

  if (!value) return null

  const idx = sourceText.indexOf(value)
  if (idx === -1) return null

  return { start: idx, end: idx + value.length }
}

export function buildHighlightedSourceHtml(sourceText: string, item: ReviewItem): string {
  const range = findHighlightRange(sourceText, item)

  if (!range) return escapeHtml(sourceText)

  return (
    escapeHtml(sourceText.slice(0, range.start)) +
    '<mark data-review-highlight="true">' +
    escapeHtml(sourceText.slice(range.start, range.end)) +
    '</mark>' +
    escapeHtml(sourceText.slice(range.end))
  )
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
