import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  X,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReviewDecision, ReviewItem, ReviewSample } from '@/types/domain'
import {
  buildHighlightedSourceHtml,
  scrollHighlightedTextIntoView,
} from '../utils/highlight-source'

function isOwnLock(sample: ReviewSample | null, userId: string): boolean {
  if (!sample?.locked_by || !sample.locked_until) return false
  return (
    sample.locked_by === userId &&
    new Date(sample.locked_until).getTime() > Date.now()
  )
}

const VERDICT_STYLE = {
  CORRECT: {
    bg: 'rgba(52,211,153,0.12)',
    color: '#34d399',
    border: 'rgba(52,211,153,0.3)',
    label: 'Correct',
    Icon: Check,
  },
  WRONG_LABEL: {
    bg: 'rgba(248,113,113,0.12)',
    color: '#f87171',
    border: 'rgba(248,113,113,0.3)',
    label: 'Wrong Label',
    Icon: XCircle,
  },
  UNREALISTIC_VALUE: {
    bg: 'rgba(251,191,36,0.12)',
    color: '#fbbf24',
    border: 'rgba(251,191,36,0.3)',
    label: 'Unrealistic',
    Icon: AlertTriangle,
  },
} as const

interface ReviewModalProps {
  item: ReviewItem | null
  sample: ReviewSample | null
  currentIndex: number
  totalCount: number
  saving: boolean
  acquiringLock: boolean
  currentUserId: string
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onSubmit: (
    item: ReviewItem,
    sample: ReviewSample,
    decision: ReviewDecision,
    note: string,
  ) => Promise<void>
}

export function ReviewModal({
  item,
  sample,
  currentIndex,
  totalCount,
  saving,
  acquiringLock,
  currentUserId,
  onPrev,
  onNext,
  onClose,
  onSubmit,
}: ReviewModalProps) {
  const [reviewerNote, setReviewerNote] = useState('')
  const [showSubDialog, setShowSubDialog] = useState(false)
  const sourceContextRef = useRef<HTMLDivElement>(null)

  const hasLock = isOwnLock(sample, currentUserId)
  const canAct = hasLock && !saving && !acquiringLock

  // Reset local state on item change
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setReviewerNote('')
      setShowSubDialog(false)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [item?.id])

  // Keyboard shortcuts — only active when modal is open
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't intercept typing in form fields
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onClose()
          return

        case 'ArrowRight':
        case 'ArrowDown':
          if (!acquiringLock) {
            e.preventDefault()
            onNext()
          }
          return

        case 'ArrowLeft':
        case 'ArrowUp':
          if (!acquiringLock) {
            e.preventDefault()
            onPrev()
          }
          return

        case 'Enter':
          if (canAct && item && sample) {
            e.preventDefault()
            setShowSubDialog(false)
            void onSubmit(item, sample, 'accept', reviewerNote)
          }
          return

        case 'Backspace':
          if (canAct && item && sample) {
            e.preventDefault()
            if (item.verdict === 'UNREALISTIC_VALUE') {
              setShowSubDialog((v) => !v)
            } else {
              setShowSubDialog(false)
              void onSubmit(item, sample, 'deny', reviewerNote)
            }
          }
          return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canAct, item, sample, reviewerNote, acquiringLock, onClose, onNext, onPrev, onSubmit])

  const verdictStyle = item ? VERDICT_STYLE[item.verdict as keyof typeof VERDICT_STYLE] : null
  const VerdictIcon = verdictStyle?.Icon ?? null
  // Only render source context when the loaded sample actually belongs to the active item,
  // preventing a brief flash of the previous sample's text during navigation.
  const ctxHtml =
    item && sample && sample.id === item.sample_row_id
      ? buildHighlightedSourceHtml(sample.current_source_text, item, sample.current_privacy_mask)
      : ''

  useEffect(() => {
    if (!ctxHtml) return undefined
    return scrollHighlightedTextIntoView(sourceContextRef.current)
  }, [ctxHtml])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070c]/75 px-3 py-5 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-sample-title"
        className="w-[720px] max-w-[94vw] max-h-[88vh] overflow-y-auto overscroll-contain rounded-lg border border-[#343a4f] bg-[#171a23] shadow-[0_24px_80px_rgba(0,0,0,0.48)]"
      >
        {/* ── Header ── */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#2e3345] bg-[#171a23]/95 px-5 py-4">
          <div className="min-w-0">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#9ca3b8]">
              Verification Sample
            </p>
            <h2
              id="review-sample-title"
              className="truncate text-[15px] font-semibold text-[#e4e6ed]"
            >
              {item ? `Sample #${item.sample_key.split('#').at(-1)}` : 'Loading…'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-[#9ca3b8] transition-[background-color,border-color,color] hover:border-[#343a4f] hover:bg-[#232733] hover:text-[#e4e6ed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {/* ── Prev / Next navigation ── */}
          <div className="mb-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex <= 0 || acquiringLock}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2e3345] bg-[#232733] px-3 py-1.5 text-xs font-medium text-[#e4e6ed] transition-[background-color,border-color,color] hover:border-[#60a5fa] hover:text-[#ffffff] disabled:cursor-default disabled:opacity-35 disabled:hover:border-[#2e3345] disabled:hover:text-[#e4e6ed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
          >
            <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Prev
          </button>
          <span
            className="flex-1 text-center text-xs tabular-nums text-[#9ca3b8]"
            aria-live="polite"
          >
            {currentIndex + 1} / {totalCount}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={currentIndex >= totalCount - 1 || acquiringLock}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2e3345] bg-[#232733] px-3 py-1.5 text-xs font-medium text-[#e4e6ed] transition-[background-color,border-color,color] hover:border-[#60a5fa] hover:text-[#ffffff] disabled:cursor-default disabled:opacity-35 disabled:hover:border-[#2e3345] disabled:hover:text-[#e4e6ed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
          >
            Next
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          </div>

          {/* ── Body ── */}
          {!item ? (
          <div className="py-12 text-center" style={{ color: '#f87171' }}>
            <p className="text-sm mb-3">Failed to load item</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs transition-[background-color,border-color,color] hover:border-[#60a5fa] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
              style={{ border: '1px solid #2e3345', background: '#232733', color: '#e4e6ed' }}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* ── Detail grid ── */}
            <div className="mb-5 grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-md border border-[#2e3345] bg-[#11141c] p-3 text-[13px]">
              <span className="pt-0.5 font-medium" style={{ color: '#9ca3b8' }}>
                Value
              </span>
              <span
                className="min-w-0 break-words font-mono text-[12px]"
                style={{ color: '#e4e6ed' }}
              >
                {item.value}
              </span>

              <span className="pt-0.5 font-medium" style={{ color: '#9ca3b8' }}>
                Verdict
              </span>
              <span>
                {verdictStyle && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      background: verdictStyle.bg,
                      color: verdictStyle.color,
                      border: `1px solid ${verdictStyle.border}`,
                    }}
                  >
                    {VerdictIcon && <VerdictIcon aria-hidden="true" className="h-3 w-3" />}
                    {verdictStyle.label}
                  </span>
                )}
              </span>

              <span className="pt-0.5 font-medium" style={{ color: '#9ca3b8' }}>
                Reason
              </span>
              <span className="min-w-0 break-words" style={{ color: '#e4e6ed' }}>
                {item.reason || '—'}
              </span>

              {item.suggested_label && (
                <>
                  <span className="pt-0.5 font-medium" style={{ color: '#9ca3b8' }}>
                    Suggested
                  </span>
                  <span
                    className="inline-block w-fit max-w-full rounded px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}
                  >
                    {item.suggested_label}
                  </span>
                </>
              )}

              {item.replacement_value && (
                <>
                  <span className="pt-0.5 font-medium" style={{ color: '#9ca3b8' }}>
                    Replacement
                  </span>
                  <span
                    className="inline-block w-fit max-w-full break-words rounded px-2 py-0.5 font-mono text-[11px]"
                    style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}
                  >
                    {item.replacement_value}
                  </span>
                </>
              )}
            </div>

            {/* ── Source context ── */}
            {ctxHtml ? (
              <div className="mb-5">
                <div
                  className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: '#60a5fa' }}
                >
                  <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                  Source Context
                </div>
                <div
                  ref={sourceContextRef}
                  className={cn(
                    'rounded-md border border-[#343a4f] p-3 text-[13px] leading-7',
                    'max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words',
                    'review-source-context',
                  )}
                  style={{ background: '#11141c', color: '#e4e6ed' }}
                  dangerouslySetInnerHTML={{ __html: ctxHtml }}
                />
              </div>
            ) : acquiringLock ? (
              <div
                className="mb-5 flex items-center gap-2 rounded-md border border-[#2e3345] p-3 text-[12px]"
                style={{ background: '#232733', color: '#9ca3b8' }}
              >
                <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
                Loading context…
              </div>
            ) : (
              <div
                className="mb-5 rounded-md border border-[#2e3345] p-3 text-[12px] italic"
                style={{ background: '#232733', color: '#9ca3b8' }}
              >
                Context not available
              </div>
            )}

            {/* ── Reviewer note ── */}
            <div className="mb-5">
              <textarea
                aria-label="Reviewer note"
                name="reviewer-note"
                autoComplete="off"
                value={reviewerNote}
                onChange={(e) => setReviewerNote(e.target.value)}
                placeholder="Optional reviewer note…"
                rows={2}
                className="w-full resize-none rounded-md px-3 py-2 text-sm transition-[border-color,background-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                style={{
                  background: '#232733',
                  border: '1px solid #2e3345',
                  color: '#e4e6ed',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#60a5fa')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2e3345')}
              />
            </div>

            {/* ── Action bar ── */}
            <div
              className="pt-4 flex items-center gap-3 flex-wrap"
              style={{ borderTop: '1px solid #2e3345' }}
            >
              <span className="text-[11px]" style={{ color: '#9ca3b8' }}>
                Decision:
              </span>

              {/* Accept */}
              <button
                type="button"
                disabled={!canAct}
                onClick={() => {
                  if (!canAct || !sample) return
                  setShowSubDialog(false)
                  void onSubmit(item, sample, 'accept', reviewerNote)
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] font-semibold transition-[background-color,border-color,color,opacity] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                style={{
                  background: 'rgba(52,211,153,0.12)',
                  color: '#34d399',
                  border: '1px solid rgba(52,211,153,0.3)',
                  opacity: canAct ? 1 : 0.35,
                  cursor: canAct ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => {
                  if (!canAct) return
                  ;(e.currentTarget as HTMLElement).style.background = 'rgba(52,211,153,0.25)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = '#34d399'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'rgba(52,211,153,0.12)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(52,211,153,0.3)'
                }}
              >
                <Check aria-hidden="true" className="h-3.5 w-3.5" />
                Accept
                {canAct && (
                  <kbd
                    className="ml-1 rounded px-1 py-0.5 text-[10px] font-normal"
                    style={{
                      border: '1px solid rgba(52,211,153,0.4)',
                      opacity: 0.7,
                    }}
                  >
                    Enter
                  </kbd>
                )}
              </button>

              {/* Deny */}
              <button
                type="button"
                disabled={!canAct}
                onClick={() => {
                  if (!canAct || !sample) return
                  if (item.verdict === 'UNREALISTIC_VALUE') {
                    setShowSubDialog((v) => !v)
                  } else {
                    setShowSubDialog(false)
                    void onSubmit(item, sample, 'deny', reviewerNote)
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] font-semibold transition-[background-color,border-color,color,opacity] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                style={{
                  background: showSubDialog ? '#f87171' : 'rgba(248,113,113,0.12)',
                  color: showSubDialog ? '#fff' : '#f87171',
                  border: `1px solid ${showSubDialog ? '#f87171' : 'rgba(248,113,113,0.3)'}`,
                  opacity: canAct ? 1 : 0.35,
                  cursor: canAct ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => {
                  if (!canAct || showSubDialog) return
                  ;(e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.25)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = '#f87171'
                }}
                onMouseLeave={(e) => {
                  if (showSubDialog) return
                  ;(e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.12)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(248,113,113,0.3)'
                }}
              >
                <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
                Deny
                {canAct && (
                  <kbd
                    className="ml-1 rounded px-1 py-0.5 text-[10px] font-normal"
                    style={{
                      border: '1px solid rgba(248,113,113,0.4)',
                      opacity: 0.7,
                    }}
                  >
                    Backspace
                  </kbd>
                )}
              </button>

              {/* Already-reviewed status */}
              {item.status === 'completed' && item.decision && (
                <span
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider"
                  style={{
                    color: item.decision === 'accept' ? '#34d399' : '#f87171',
                  }}
                >
                  {item.decision === 'accept' ? (
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                  {item.decision === 'accept' ? 'Accepted' : 'Denied'}
                </span>
              )}

              {acquiringLock && !saving && (
                <span
                  className="ml-auto text-[11px] flex items-center gap-1.5"
                  style={{ color: '#60a5fa' }}
                >
                  <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
                  Acquiring lock…
                </span>
              )}

              {saving && (
                <span className="ml-auto text-[11px]" style={{ color: '#fbbf24' }}>
                  Saving…
                </span>
              )}
            </div>

            {/* ── Sub-dialog for UNREALISTIC deny ── */}
            {showSubDialog && (
              <div
                className="mt-3 rounded-lg p-3 text-sm"
                style={{ background: '#232733', border: '1px solid #2e3345' }}
              >
                <p className="text-[12px] mb-3" style={{ color: '#9ca3b8' }}>
                  What would you like to do with this sample?
                </p>
                <div className="flex gap-2">
                  {(
                    [
                      { label: 'Keep as-is', decision: 'deny_keep' as ReviewDecision },
                      { label: 'Remove label', decision: 'deny_remove' as ReviewDecision },
                    ] as const
                  ).map(({ label, decision }) => (
                    <button
                      key={decision}
                      type="button"
                      onClick={() => {
                        setShowSubDialog(false)
                        if (sample) void onSubmit(item, sample, decision, reviewerNote)
                      }}
                      className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-[background-color,border-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                      style={{
                        border: '1px solid #2e3345',
                        background: '#1a1d27',
                        color: '#e4e6ed',
                      }}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background =
                          'rgba(96,165,250,0.1)'
                        ;(e.currentTarget as HTMLElement).style.borderColor = '#60a5fa'
                        ;(e.currentTarget as HTMLElement).style.color = '#60a5fa'
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = '#1a1d27'
                        ;(e.currentTarget as HTMLElement).style.borderColor = '#2e3345'
                        ;(e.currentTarget as HTMLElement).style.color = '#e4e6ed'
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Lock status: only warn when we don't have the lock AND aren't in the process of getting it ── */}
            {!hasLock && !acquiringLock && sample?.locked_by && sample.locked_by !== currentUserId && (
              <p
                className="mt-3 flex items-center gap-1.5 text-[11px]"
                style={{ color: '#f87171' }}
              >
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                This sample is locked by another reviewer
              </p>
            )}
          </>
        )}
      </div>
    </div>
    </div>
  )
}
