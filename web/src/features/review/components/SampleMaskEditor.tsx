import {
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { MousePointer2, Pencil, Save, Scissors, Tag, Trash2, X } from 'lucide-react'
import type { PrivacyMaskEntry, ReviewSample } from '@/types/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type TextRange = {
  start: number
  end: number
}

type TextEdit = {
  start: number
  oldEnd: number
  newEnd: number
}

type MaskSegment = TextRange & {
  entry: PrivacyMaskEntry
  index: number
}

type SampleMaskEditorProps = {
  sample: ReviewSample
  labelOptions: string[]
  saving: boolean
  canEdit: boolean
  onClose: () => void
  onSave: (
    sample: ReviewSample,
    sourceText: string,
    privacyMask: PrivacyMaskEntry[],
  ) => Promise<void>
}

// ─── Label Color Palette ─────────────────────────────────────────────────────

const LABEL_PALETTE = [
  {
    span: 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-200',
    spanHover: 'hover:bg-sky-200/80 dark:hover:bg-sky-800/60',
    spanActive:
      'bg-sky-200 text-sky-950 ring-2 ring-sky-400/80 ring-offset-1 dark:bg-sky-800/70 dark:text-sky-100 dark:ring-sky-500/80',
    badge:
      'bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-900/60 dark:text-sky-300 dark:border-sky-700/50',
    itemActive: 'border-sky-400/70 bg-sky-500/15 ring-1 ring-sky-400/25',
    dot: 'bg-sky-500',
  },
  {
    span: 'bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200',
    spanHover: 'hover:bg-rose-200/80 dark:hover:bg-rose-800/60',
    spanActive:
      'bg-rose-200 text-rose-950 ring-2 ring-rose-400/80 ring-offset-1 dark:bg-rose-800/70 dark:text-rose-100 dark:ring-rose-500/80',
    badge:
      'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-900/60 dark:text-rose-300 dark:border-rose-700/50',
    itemActive: 'border-rose-400/70 bg-rose-500/15 ring-1 ring-rose-400/25',
    dot: 'bg-rose-500',
  },
  {
    span: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200',
    spanHover: 'hover:bg-amber-200/80 dark:hover:bg-amber-800/60',
    spanActive:
      'bg-amber-200 text-amber-950 ring-2 ring-amber-400/80 ring-offset-1 dark:bg-amber-800/70 dark:text-amber-100 dark:ring-amber-500/80',
    badge:
      'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-900/60 dark:text-amber-300 dark:border-amber-700/50',
    itemActive: 'border-amber-400/70 bg-amber-500/15 ring-1 ring-amber-400/25',
    dot: 'bg-amber-500',
  },
  {
    span: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200',
    spanHover: 'hover:bg-emerald-200/80 dark:hover:bg-emerald-800/60',
    spanActive:
      'bg-emerald-200 text-emerald-950 ring-2 ring-emerald-400/80 ring-offset-1 dark:bg-emerald-800/70 dark:text-emerald-100 dark:ring-emerald-500/80',
    badge:
      'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-700/50',
    itemActive: 'border-emerald-400/70 bg-emerald-500/15 ring-1 ring-emerald-400/25',
    dot: 'bg-emerald-500',
  },
  {
    span: 'bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-200',
    spanHover: 'hover:bg-violet-200/80 dark:hover:bg-violet-800/60',
    spanActive:
      'bg-violet-200 text-violet-950 ring-2 ring-violet-400/80 ring-offset-1 dark:bg-violet-800/70 dark:text-violet-100 dark:ring-violet-500/80',
    badge:
      'bg-violet-50 text-violet-700 border-violet-200/80 dark:bg-violet-900/60 dark:text-violet-300 dark:border-violet-700/50',
    itemActive: 'border-violet-400/70 bg-violet-500/15 ring-1 ring-violet-400/25',
    dot: 'bg-violet-500',
  },
  {
    span: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-900/50 dark:text-cyan-200',
    spanHover: 'hover:bg-cyan-200/80 dark:hover:bg-cyan-800/60',
    spanActive:
      'bg-cyan-200 text-cyan-950 ring-2 ring-cyan-400/80 ring-offset-1 dark:bg-cyan-800/70 dark:text-cyan-100 dark:ring-cyan-500/80',
    badge:
      'bg-cyan-50 text-cyan-700 border-cyan-200/80 dark:bg-cyan-900/60 dark:text-cyan-300 dark:border-cyan-700/50',
    itemActive: 'border-cyan-400/70 bg-cyan-500/15 ring-1 ring-cyan-400/25',
    dot: 'bg-cyan-500',
  },
  {
    span: 'bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200',
    spanHover: 'hover:bg-orange-200/80 dark:hover:bg-orange-800/60',
    spanActive:
      'bg-orange-200 text-orange-950 ring-2 ring-orange-400/80 ring-offset-1 dark:bg-orange-800/70 dark:text-orange-100 dark:ring-orange-500/80',
    badge:
      'bg-orange-50 text-orange-700 border-orange-200/80 dark:bg-orange-900/60 dark:text-orange-300 dark:border-orange-700/50',
    itemActive: 'border-orange-400/70 bg-orange-500/15 ring-1 ring-orange-400/25',
    dot: 'bg-orange-500',
  },
  {
    span: 'bg-pink-100 text-pink-900 dark:bg-pink-900/50 dark:text-pink-200',
    spanHover: 'hover:bg-pink-200/80 dark:hover:bg-pink-800/60',
    spanActive:
      'bg-pink-200 text-pink-950 ring-2 ring-pink-400/80 ring-offset-1 dark:bg-pink-800/70 dark:text-pink-100 dark:ring-pink-500/80',
    badge:
      'bg-pink-50 text-pink-700 border-pink-200/80 dark:bg-pink-900/60 dark:text-pink-300 dark:border-pink-700/50',
    itemActive: 'border-pink-400/70 bg-pink-500/15 ring-1 ring-pink-400/25',
    dot: 'bg-pink-500',
  },
] as const

type LabelColors = (typeof LABEL_PALETTE)[number]

const LABEL_SELECT_TRIGGER_CLASS_NAME =
  'w-60 max-w-full border-border/80 bg-background/95 px-3.5 text-[15px] font-bold leading-none text-foreground shadow-sm hover:border-primary/50 hover:bg-background focus-visible:border-primary/70 focus-visible:ring-primary/25 data-[size=sm]:h-9 data-placeholder:text-muted-foreground'
const LABEL_SELECT_CONTENT_CLASS_NAME =
  'min-w-60 border border-border/70 bg-popover/95 p-1 shadow-xl shadow-black/30'
const LABEL_SELECT_ITEM_CLASS_NAME =
  'py-2 pr-9 pl-2.5 text-[15px] font-semibold text-foreground'

function sortLabelOptions(labels: string[]): string[] {
  return [...labels].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

function getLabelColors(label: string | undefined): LabelColors {
  if (!label) return LABEL_PALETTE[0]
  let hash = 0
  for (let i = 0; i < label.length; i++) {
    hash = ((hash * 31) + label.charCodeAt(i)) >>> 0
  }
  return LABEL_PALETTE[hash % LABEL_PALETTE.length]
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isValidRange(sourceText: string, start: unknown, end: unknown): start is number {
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= sourceText.length
  )
}

function rangesOverlap(a: TextRange, b: TextRange): boolean {
  return a.start < b.end && b.start < a.end
}

function getEntryRange(sourceText: string, entry: PrivacyMaskEntry): TextRange | null {
  if (isValidRange(sourceText, entry.start, entry.end)) {
    return { start: entry.start, end: entry.end as number }
  }

  if (!entry.value) return null
  const idx = sourceText.indexOf(entry.value)
  if (idx === -1) return null
  return { start: idx, end: idx + entry.value.length }
}

function buildSegments(sourceText: string, mask: PrivacyMaskEntry[]): MaskSegment[] {
  const segments: MaskSegment[] = []

  mask.forEach((entry, index) => {
    const range = getEntryRange(sourceText, entry)
    if (!range) return

    if (segments.some((segment) => rangesOverlap(segment, range))) return
    segments.push({ ...range, entry, index })
  })

  return segments.sort((a, b) => a.start - b.start || a.end - b.end)
}

function normalizeEntry(sourceText: string, entry: PrivacyMaskEntry): PrivacyMaskEntry {
  if (!isValidRange(sourceText, entry.start, entry.end)) return entry

  return {
    ...entry,
    value: sourceText.slice(entry.start, entry.end as number),
    start: entry.start,
    end: entry.end,
  }
}

function normalizeMask(sourceText: string, mask: PrivacyMaskEntry[]): PrivacyMaskEntry[] {
  return mask.map((entry) => normalizeEntry(sourceText, entry))
}

function findTextEdit(previousText: string, nextText: string): TextEdit | null {
  if (previousText === nextText) return null

  let start = 0
  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start += 1
  }

  let oldEnd = previousText.length
  let newEnd = nextText.length
  while (
    oldEnd > start &&
    newEnd > start &&
    previousText[oldEnd - 1] === nextText[newEnd - 1]
  ) {
    oldEnd -= 1
    newEnd -= 1
  }

  return { start, oldEnd, newEnd }
}

function remapRangeAfterTextEdit(range: TextRange, edit: TextEdit): TextRange | null {
  const insertedLength = edit.newEnd - edit.start
  const removedLength = edit.oldEnd - edit.start
  const delta = insertedLength - removedLength

  if (removedLength === 0) {
    // Ranges are half-open [start, end): typing at either edge is outside the span.
    if (range.end <= edit.start) return range
    if (range.start >= edit.start) {
      return { start: range.start + delta, end: range.end + delta }
    }

    return { start: range.start, end: range.end + delta }
  }

  if (range.end <= edit.start) return range
  if (range.start >= edit.oldEnd) {
    return { start: range.start + delta, end: range.end + delta }
  }

  const start = range.start < edit.start ? range.start : edit.start
  const end = range.end > edit.oldEnd ? range.end + delta : edit.newEnd
  return end > start ? { start, end } : null
}

function remapMaskAfterSourceTextChange(
  previousText: string,
  nextText: string,
  mask: PrivacyMaskEntry[],
): PrivacyMaskEntry[] {
  const edit = findTextEdit(previousText, nextText)
  if (!edit) return normalizeMask(nextText, mask)

  return mask
    .map((entry) => {
      const range = getEntryRange(previousText, entry)
      if (!range) return normalizeEntry(nextText, entry)

      const nextRange = remapRangeAfterTextEdit(range, edit)
      if (!nextRange || !isValidRange(nextText, nextRange.start, nextRange.end)) {
        return null
      }

      return {
        ...entry,
        value: nextText.slice(nextRange.start, nextRange.end),
        start: nextRange.start,
        end: nextRange.end,
      }
    })
    .filter((entry): entry is PrivacyMaskEntry => entry != null)
    .sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9))
}

function textPreview(value: string | undefined, fallback = 'No text'): string {
  if (!value) return fallback
  return value.length > 40 ? `${value.slice(0, 37)}…` : value
}

function getSelectableTextLength(range: Range): number {
  const fragment = range.cloneContents()
  fragment.querySelectorAll('[data-selection-ignore="true"]').forEach((element) => {
    element.remove()
  })

  return fragment.textContent?.length ?? 0
}

function findSelectionRange(container: HTMLElement): TextRange | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null

  const range = selection.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null
  }

  const prefix = document.createRange()
  prefix.selectNodeContents(container)
  prefix.setEnd(range.startContainer, range.startOffset)

  const start = getSelectableTextLength(prefix)
  const end = start + getSelectableTextLength(range)
  if (end <= start) return null

  return { start, end }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SampleMaskEditor({
  sample,
  labelOptions,
  saving,
  canEdit,
  onClose,
  onSave,
}: SampleMaskEditorProps) {
  const sourceRef = useRef<HTMLDivElement>(null)
  const sourceEditorRef = useRef<HTMLDivElement>(null)
  const isComposingTextRef = useRef(false)
  const compositionStartTextRef = useRef<string | null>(null)
  const compositionStartMaskRef = useRef<PrivacyMaskEntry[] | null>(null)
  const lastCommittedCompositionTextRef = useRef<string | null>(null)
  const [draftSourceText, setDraftSourceText] = useState(sample.current_source_text)
  const sourceText = draftSourceText
  const [draftMask, setDraftMask] = useState<PrivacyMaskEntry[]>(() =>
    normalizeMask(sample.current_source_text, sample.current_privacy_mask),
  )
  const [isEditingText, setIsEditingText] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectionRange, setSelectionRange] = useState<TextRange | null>(null)
  const [selectedLabel, setSelectedLabel] = useState(() => sortLabelOptions(labelOptions)[0] ?? '')

  const sortedLabelOptions = useMemo(() => sortLabelOptions(labelOptions), [labelOptions])
  const effectiveSelectedLabel = selectedLabel || sortedLabelOptions[0] || ''
  const segments = useMemo(() => buildSegments(sourceText, draftMask), [draftMask, sourceText])
  const selectedEntry = selectedIndex == null ? null : (draftMask[selectedIndex] ?? null)
  const selectedText = selectionRange
    ? sourceText.slice(selectionRange.start, selectionRange.end)
    : ''
  const hasSelection = selectionRange != null

  const hasOverlap = useMemo(() => {
    const ranges = draftMask.map((entry) => getEntryRange(sourceText, entry))

    return ranges.some((range, index) => {
      if (!range) return false
      return ranges.some((other, otherIndex) => {
        if (!other || otherIndex === index) return false
        return rangesOverlap(range, other)
      })
    })
  }, [draftMask, sourceText])

  const invalidCount = useMemo(
    () =>
      draftMask
        .filter((entry) => entry.start != null || entry.end != null)
        .filter((entry) => !isValidRange(sourceText, entry.start, entry.end)).length,
    [draftMask, sourceText],
  )

  const isDirty = useMemo(
    () =>
      sample.current_source_text !== sourceText ||
      JSON.stringify(normalizeMask(sample.current_source_text, sample.current_privacy_mask)) !==
      JSON.stringify(draftMask),
    [draftMask, sample.current_privacy_mask, sample.current_source_text, sourceText],
  )

  useEffect(() => {
    if (!isEditingText) return

    function closeTextEditorOnOutsideClick(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (sourceEditorRef.current?.contains(target)) return

      setIsEditingText(false)
    }

    document.addEventListener('pointerdown', closeTextEditorOnOutsideClick)
    return () => {
      document.removeEventListener('pointerdown', closeTextEditorOnOutsideClick)
    }
  }, [isEditingText])

  function captureSelection() {
    if (!sourceRef.current) return
    const range = findSelectionRange(sourceRef.current)
    if (!range) return
    setSelectionRange(range)
  }

  function clearActiveSelection() {
    setSelectedIndex(null)
    setSelectionRange(null)
    window.getSelection()?.removeAllRanges()
  }

  function updateSourceText(nextSourceText: string) {
    setDraftMask((prev) => remapMaskAfterSourceTextChange(sourceText, nextSourceText, prev))
    setDraftSourceText(nextSourceText)
    setSelectedIndex(null)
    setSelectionRange(null)
  }

  function updateSourceTextWithoutRemapping(nextSourceText: string) {
    setDraftSourceText(nextSourceText)
    setSelectedIndex(null)
    setSelectionRange(null)
  }

  function handleSourceTextCompositionStart() {
    isComposingTextRef.current = true
    compositionStartTextRef.current = sourceText
    compositionStartMaskRef.current = draftMask
    lastCommittedCompositionTextRef.current = null
  }

  function handleSourceTextCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>) {
    isComposingTextRef.current = false

    const nextSourceText = event.currentTarget.value
    const baseText = compositionStartTextRef.current ?? sourceText
    const baseMask = compositionStartMaskRef.current ?? draftMask

    setDraftMask(remapMaskAfterSourceTextChange(baseText, nextSourceText, baseMask))
    setDraftSourceText(nextSourceText)
    setSelectedIndex(null)
    setSelectionRange(null)

    compositionStartTextRef.current = null
    compositionStartMaskRef.current = null
    lastCommittedCompositionTextRef.current = nextSourceText
  }

  function handleSourceTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextSourceText = event.currentTarget.value

    if (lastCommittedCompositionTextRef.current === nextSourceText) {
      lastCommittedCompositionTextRef.current = null
      return
    }

    if (isComposingTextRef.current) {
      updateSourceTextWithoutRemapping(nextSourceText)
      return
    }

    updateSourceText(nextSourceText)
  }

  function toggleTextEditor() {
    setIsEditingText((prev) => !prev)
    clearActiveSelection()
  }

  function updateEntry(index: number, nextEntry: PrivacyMaskEntry) {
    setDraftMask((prev) =>
      prev.map((entry, entryIndex) =>
        entryIndex === index ? normalizeEntry(sourceText, nextEntry) : entry,
      ),
    )
  }

  function selectEntry(index: number) {
    const entry = draftMask[index]
    if (selectedIndex === index) {
      clearActiveSelection()
      return
    }

    setSelectedIndex(index)
    setSelectionRange(null)
    if (entry?.label) setSelectedLabel(entry.label)
  }

  function removeEntry(index: number) {
    setDraftMask((prev) => prev.filter((_, entryIndex) => entryIndex !== index))
    setSelectedIndex((prev) => {
      if (prev == null) return null
      if (prev === index) return null
      return prev > index ? prev - 1 : prev
    })
  }

  function selectionOverlapsExisting(ignoreIndex: number | null) {
    if (!selectionRange) return false
    return draftMask.some((entry, index) => {
      if (index === ignoreIndex) return false
      const range = getEntryRange(sourceText, entry)
      return range ? rangesOverlap(selectionRange, range) : false
    })
  }

  function addSelectionAsEntry() {
    if (!selectionRange || !effectiveSelectedLabel) return
    if (selectionOverlapsExisting(null)) return

    const entry: PrivacyMaskEntry = {
      value: sourceText.slice(selectionRange.start, selectionRange.end),
      label: effectiveSelectedLabel,
      start: selectionRange.start,
      end: selectionRange.end,
    }

    setDraftMask((prev) => [...prev, entry].sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9)))
    setSelectedIndex(null)
    setSelectionRange(null)
  }

  function applySelectionToEntry() {
    if (selectedIndex == null || !selectionRange || !selectedEntry) return
    if (selectionOverlapsExisting(selectedIndex)) return

    updateEntry(selectedIndex, {
      ...selectedEntry,
      value: sourceText.slice(selectionRange.start, selectionRange.end),
      start: selectionRange.start,
      end: selectionRange.end,
    })
    setSelectionRange(null)
  }

  function handleSpanKeyDown(event: KeyboardEvent<HTMLSpanElement>, index: number) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectEntry(index)
  }

  function handleSourceKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    if (selectedIndex == null && selectionRange == null) return

    event.preventDefault()
    clearActiveSelection()
  }

  async function saveMask() {
    await onSave(sample, sourceText, normalizeMask(sourceText, draftMask))
  }

  const canTagSelection =
    canEdit && hasSelection && Boolean(effectiveSelectedLabel) && !selectionOverlapsExisting(null)
  const canApplySelection =
    canEdit && selectedIndex != null && hasSelection && !selectionOverlapsExisting(selectedIndex)
  const canSave = canEdit && isDirty && invalidCount === 0 && !hasOverlap && !saving

  // Action panel shows one of three modes
  const actionMode = selectedIndex != null ? 'entry' : hasSelection ? 'selection' : 'idle'
  const activeEntryColors = getLabelColors(selectedEntry?.label)
  const selectedLabelColors = getLabelColors(effectiveSelectedLabel)
  const selectionOverlaps = selectionOverlapsExisting(selectedIndex)

  return (
    <Card size="sm" className="mb-6 rounded-xl border border-border/80 bg-card shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Tag className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Edit Text & Labels
        </CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close label editor"
            onClick={onClose}
          >
            <X />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {/* ── Source text with colored, labeled spans ── */}
        <div ref={sourceEditorRef} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Source text
            </span>
            <Button
              type="button"
              size="xs"
              variant={isEditingText ? 'secondary' : 'outline'}
              disabled={!canEdit}
              onClick={toggleTextEditor}
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              {isEditingText ? 'Preview' : 'Edit Text'}
            </Button>
          </div>

          {isEditingText ? (
            <Textarea
              aria-label="Edit sample source text"
              value={sourceText}
              disabled={!canEdit}
              spellCheck={false}
              className="max-h-80 min-h-64 resize-y border-border/70 bg-background/80 font-mono text-[15px] leading-7 text-foreground"
              onChange={handleSourceTextChange}
              onCompositionStart={handleSourceTextCompositionStart}
              onCompositionEnd={handleSourceTextCompositionEnd}
            />
          ) : (
            <div
              ref={sourceRef}
              role="region"
              aria-label="Sample source text — select text to tag PII"
              className={cn(
                'max-h-64 overflow-y-auto rounded-lg border border-border/70 bg-muted/20 p-4',
                'whitespace-pre-wrap break-words text-[15px] leading-8 text-foreground',
                'selection:bg-primary/20 selection:text-foreground',
                'transition-colors duration-150 focus-within:border-primary/40',
              )}
              onMouseUp={captureSelection}
              onKeyDown={handleSourceKeyDown}
              onKeyUp={captureSelection}
            >
              {segments.length === 0
                ? sourceText
                : segments.map((segment, segmentIndex) => {
                    const previousEnd = segmentIndex === 0 ? 0 : segments[segmentIndex - 1].end
                    const isSelected = selectedIndex === segment.index
                    const colors = getLabelColors(segment.entry.label)

                    return (
                      <span key={`${segment.index}-${segment.start}-${segment.end}`}>
                        {sourceText.slice(previousEnd, segment.start)}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`${segment.entry.label ?? 'PII'} span: ${segment.entry.value ?? ''}`}
                          aria-pressed={isSelected}
                          className={cn(
                            'inline-flex cursor-pointer items-baseline rounded-[4px] px-1 py-[0.1em]',
                            'font-[450] transition-all duration-150 ease-out',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                            isSelected
                              ? colors.spanActive
                              : cn(colors.span, colors.spanHover),
                          )}
                          onClick={() => selectEntry(segment.index)}
                          onKeyDown={(event) => handleSpanKeyDown(event, segment.index)}
                        >
                          {sourceText.slice(segment.start, segment.end)}
                          <span
                            data-selection-ignore="true"
                            className="ml-1.5 select-none rounded-[4px] bg-background/45 px-1.5 py-0.5 align-middle text-[10.5px] font-extrabold uppercase leading-none tracking-wide text-foreground/85 shadow-sm"
                            aria-hidden="true"
                          >
                            {segment.entry.label}
                          </span>
                        </span>
                        {segmentIndex === segments.length - 1 ? sourceText.slice(segment.end) : null}
                      </span>
                    )
                  })}
            </div>
          )}
        </div>

        {/* ── Main editing area ── */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">

          {/* Action panel — context-sensitive */}
          <div
            className={cn(
              'flex flex-col rounded-lg border transition-colors duration-200',
              actionMode === 'idle' && 'border-border/70 bg-muted/30 shadow-inner',
              actionMode === 'selection' && 'border-primary/30 bg-primary/5 dark:bg-primary/10',
              actionMode === 'entry' && cn('border-border/50 bg-card/60', selectedIndex != null && activeEntryColors.itemActive),
            )}
          >
            {/* Idle */}
            {actionMode === 'idle' && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-7 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary shadow-sm">
                  <MousePointer2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="max-w-[300px] text-sm font-medium leading-relaxed text-foreground/90">
                  Select text above to tag it, or click a highlighted span to edit it.
                </p>
              </div>
            )}

            {/* Text selected — tag new span */}
            {actionMode === 'selection' && (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Selected
                  </span>
                  <span
                    className="min-w-0 truncate rounded-md bg-background/70 px-2.5 py-1.5 font-mono text-sm text-foreground"
                    title={selectedText}
                  >
                    "{textPreview(selectedText)}"
                  </span>
                </div>

                <div className="flex flex-wrap items-end gap-2.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-semibold text-muted-foreground">Tag as</span>
                    <Select
                      value={effectiveSelectedLabel}
                      onValueChange={(value) => {
                        if (value) setSelectedLabel(value)
                      }}
                      disabled={!canEdit || sortedLabelOptions.length === 0}
                    >
                      <SelectTrigger size="sm" className={LABEL_SELECT_TRIGGER_CLASS_NAME}>
                        <span
                          className={cn('h-2.5 w-2.5 shrink-0 rounded-full', selectedLabelColors.dot)}
                          aria-hidden="true"
                        />
                        <SelectValue className="min-w-0 truncate" />
                      </SelectTrigger>
                      <SelectContent className={LABEL_SELECT_CONTENT_CLASS_NAME}>
                        <SelectGroup>
                          {sortedLabelOptions.map((label) => {
                            const c = getLabelColors(label)
                            return (
                              <SelectItem key={label} value={label} className={LABEL_SELECT_ITEM_CLASS_NAME}>
                                <span className="flex items-center gap-2">
                                  <span
                                    className={cn('h-2.5 w-2.5 shrink-0 rounded-full', c.dot)}
                                    aria-hidden="true"
                                  />
                                  {label}
                                </span>
                              </SelectItem>
                            )
                          })}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    disabled={!canTagSelection}
                    onClick={addSelectionAsEntry}
                  >
                    <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                    Tag Selection
                  </Button>
                </div>

                {selectionOverlaps && (
                  <p className="text-xs text-destructive" aria-live="polite">
                    Selection overlaps an existing span.
                  </p>
                )}
              </div>
            )}

            {/* Entry selected — edit span */}
            {actionMode === 'entry' && selectedEntry != null && (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/60 bg-background/50 px-2.5 py-2 shadow-sm">
                    <span
                      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', activeEntryColors.dot)}
                      aria-hidden="true"
                    />
                    <span className="shrink-0 text-sm font-bold text-foreground">
                      {selectedEntry.label ?? 'Unlabeled'}
                    </span>
                    <span className="text-border" aria-hidden="true">/</span>
                    <span
                      className="min-w-0 truncate font-mono text-sm text-muted-foreground"
                      title={selectedEntry.value}
                    >
                      {textPreview(selectedEntry.value)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Deselect active span"
                    onClick={clearActiveSelection}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    Deselect
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-2.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-semibold text-muted-foreground">Change label</span>
                    <Select
                      value={effectiveSelectedLabel}
                      onValueChange={(value) => {
                        if (!value) return
                        setSelectedLabel(value)
                        if (selectedIndex != null && selectedEntry) {
                          updateEntry(selectedIndex, { ...selectedEntry, label: value })
                        }
                      }}
                      disabled={!canEdit || sortedLabelOptions.length === 0}
                    >
                      <SelectTrigger size="sm" className={LABEL_SELECT_TRIGGER_CLASS_NAME}>
                        <span
                          className={cn('h-2.5 w-2.5 shrink-0 rounded-full', selectedLabelColors.dot)}
                          aria-hidden="true"
                        />
                        <SelectValue className="min-w-0 truncate" />
                      </SelectTrigger>
                      <SelectContent className={LABEL_SELECT_CONTENT_CLASS_NAME}>
                        <SelectGroup>
                          {sortedLabelOptions.map((label) => {
                            const c = getLabelColors(label)
                            return (
                              <SelectItem key={label} value={label} className={LABEL_SELECT_ITEM_CLASS_NAME}>
                                <span className="flex items-center gap-2">
                                  <span
                                    className={cn('h-2.5 w-2.5 shrink-0 rounded-full', c.dot)}
                                    aria-hidden="true"
                                  />
                                  {label}
                                </span>
                              </SelectItem>
                            )
                          })}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  {hasSelection && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={!canTagSelection}
                        onClick={addSelectionAsEntry}
                      >
                        <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                        Tag New
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canApplySelection}
                        onClick={applySelectionToEntry}
                      >
                        <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                        Update Span
                      </Button>
                    </>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={!canEdit}
                    onClick={() => {
                      if (selectedIndex != null) removeEntry(selectedIndex)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                </div>

                {selectionOverlaps && (
                  <p className="text-xs text-destructive" aria-live="polite">
                    Selection overlaps another span.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Span list */}
          <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-border/60 bg-card/50 p-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Spans
              </span>
              <Badge
                variant="outline"
                className="h-5 rounded-full px-2 text-[11px] tabular-nums"
                aria-label={`${draftMask.length} spans`}
              >
                {draftMask.length}
              </Badge>
            </div>

            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {draftMask.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 px-3 py-6">
                  <Tag className="h-4 w-4 text-muted-foreground/25" aria-hidden="true" />
                  <p className="text-center text-xs text-muted-foreground/45">
                    No spans tagged yet
                  </p>
                </div>
              ) : (
                draftMask.map((entry, index) => {
                  const isSelected = selectedIndex === index
                  const colors = getLabelColors(entry.label)

                  return (
                    <div
                      key={`${index}-${entry.label}-${entry.start}-${entry.end}-${entry.value}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Select ${entry.label ?? 'span'}: ${entry.value ?? ''}`}
                      aria-pressed={isSelected}
                      className={cn(
                        'group flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5',
                        'transition-all duration-150 ease-out',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1',
                        isSelected
                          ? colors.itemActive
                          : 'border-border/30 bg-card/30 hover:border-border/60 hover:bg-muted/25',
                      )}
                      onClick={() => selectEntry(index)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        selectEntry(index)
                      }}
                    >
                      <span
                        className={cn('h-2 w-2 shrink-0 rounded-full', colors.dot)}
                        aria-hidden="true"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          className={cn(
                            'truncate text-xs font-bold uppercase tracking-wide',
                            isSelected ? 'text-foreground' : 'text-foreground/90',
                          )}
                        >
                          {entry.label ?? 'Unlabeled'}
                        </span>
                        <span
                          className={cn(
                            'truncate font-mono text-xs',
                            isSelected ? 'text-muted-foreground' : 'text-muted-foreground/75',
                          )}
                        >
                          {textPreview(entry.value, '—')}
                        </span>
                      </span>

                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remove ${entry.label ?? 'span'}`}
                          className={cn(
                            'shrink-0 rounded p-0.5 transition-all duration-100',
                            'text-muted-foreground/0 hover:bg-destructive/10 hover:text-destructive',
                            'focus-visible:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive',
                            'group-hover:text-muted-foreground/50 group-hover:hover:text-destructive',
                          )}
                          onClick={(event) => {
                            event.stopPropagation()
                            removeEntry(index)
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* Global validation errors */}
        {(hasOverlap || invalidCount > 0) && (
          <p
            className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
            aria-live="polite"
          >
            {hasOverlap
              ? 'Some spans overlap — fix them before saving.'
              : `${invalidCount} span${invalidCount > 1 ? 's have' : ' has'} invalid range${invalidCount > 1 ? 's' : ''}.`}
          </p>
        )}
      </CardContent>

      <CardFooter className="justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!isDirty || saving}
          onClick={() => {
            setDraftSourceText(sample.current_source_text)
            setDraftMask(normalizeMask(sample.current_source_text, sample.current_privacy_mask))
            setIsEditingText(false)
            setSelectedIndex(null)
            setSelectionRange(null)
          }}
        >
          Reset
        </Button>
        <Button type="button" size="sm" disabled={!canSave} onClick={() => void saveMask()}>
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </CardFooter>
    </Card>
  )
}
