import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  FileText,
  LoaderCircle,
  X,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PrivacyMaskEntry, ReviewDecision, ReviewItem, ReviewSample } from '@/types/domain'
import {
  buildHighlightedSourceHtml,
  scrollHighlightedTextIntoView,
} from '../utils/highlight-source'
import { SampleMaskEditor } from './SampleMaskEditor'

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

function getDecisionDisplay(decision: ReviewDecision | null | undefined) {
  if (!decision) return null
  if (decision === 'accept') return { label: 'Accepted', color: '#34d399', Icon: Check }
  if (decision === 'deny_keep') return { label: 'Kept', color: '#f87171', Icon: XCircle }
  if (decision === 'deny_remove') return { label: 'Removed', color: '#f87171', Icon: XCircle }
  return { label: 'Denied', color: '#f87171', Icon: XCircle }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

interface ReviewModalProps {
  item: ReviewItem | null
  sample: ReviewSample | null
  currentIndex: number
  totalCount: number
  saving: boolean
  acquiringLock: boolean
  currentUserId: string
  labelOptions: string[]
  readOnly?: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onSubmit: (
    item: ReviewItem,
    sample: ReviewSample,
    decision: ReviewDecision,
    note: string,
  ) => Promise<void>
  onSaveSampleMask: (
    item: ReviewItem,
    sample: ReviewSample,
    sourceText: string,
    privacyMask: PrivacyMaskEntry[],
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
  labelOptions,
  readOnly = false,
  onPrev,
  onNext,
  onClose,
  onSubmit,
  onSaveSampleMask,
}: ReviewModalProps) {
  const [reviewerNote, setReviewerNote] = useState('')
  const [showSubDialog, setShowSubDialog] = useState(false)
  const [showMaskEditor, setShowMaskEditor] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<{
    decision: ReviewDecision
    note: string
    itemId: string
  } | null>(null)
  const sourceContextRef = useRef<HTMLDivElement>(null)

  const currentItemId = item?.id
  const pendingDecisionForItem =
    pendingDecision && pendingDecision.itemId === currentItemId ? pendingDecision : null
  const hasLock = isOwnLock(sample, currentUserId)
  const isBusy = saving || acquiringLock
  const canAct = !readOnly && hasLock && !isBusy

  // Clear stale queued intent after navigation. The derived item-id guard above
  // prevents it from firing on the wrong item before this cleanup runs.
  useEffect(() => {
    if (!pendingDecision || pendingDecision.itemId === currentItemId) return undefined

    const frame = window.requestAnimationFrame(() => {
      setPendingDecision((current) =>
        current && current.itemId !== currentItemId ? null : current,
      )
    })

    return () => window.cancelAnimationFrame(frame)
  }, [currentItemId, pendingDecision])

  // Reset visual state on item change (deferred to avoid flash of stale content)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setReviewerNote('')
      setShowSubDialog(false)
      setShowMaskEditor(false)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [currentItemId])

  // Keyboard shortcuts — only active when modal is open
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't intercept typing in form fields
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          if (!isBusy) onClose()
          return

        case 'ArrowRight':
        case 'ArrowDown':
          if (!isBusy) {
            e.preventDefault()
            onNext()
          }
          return

        case 'ArrowLeft':
        case 'ArrowUp':
          if (!isBusy) {
            e.preventDefault()
            onPrev()
          }
          return

        case 'Enter':
          if (readOnly) return
          if (item && sample) {
            e.preventDefault()
            setShowSubDialog(false)
            if (canAct) {
              void onSubmit(item, sample, 'accept', reviewerNote)
            } else if (acquiringLock && !saving) {
              setPendingDecision({ decision: 'accept', note: reviewerNote, itemId: item.id })
            }
          }
          return

        case 'Backspace':
          if (readOnly) return
          if (item && sample) {
            e.preventDefault()
            if (item.verdict === 'UNREALISTIC_VALUE' || item.verdict === 'WRONG_LABEL') {
              // Sub-dialog requires deliberate user interaction — don't queue it
              if (canAct) setShowSubDialog((v) => !v)
            } else {
              setShowSubDialog(false)
              if (canAct) {
                void onSubmit(item, sample, 'deny', reviewerNote)
              } else if (acquiringLock && !saving) {
                setPendingDecision({ decision: 'deny', note: reviewerNote, itemId: item.id })
              }
            }
          }
          return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canAct, isBusy, item, sample, readOnly, reviewerNote, saving, acquiringLock, onClose, onNext, onPrev, onSubmit])

  // Auto-fire a queued decision as soon as the lock is acquired and canAct flips true.
  // Guard on itemId so a pending decision queued for item N is never fired on item N+1
  // in case the effect runs before the item-change clear-effect above has committed.
  useEffect(() => {
    if (!canAct || !pendingDecisionForItem || !item || !sample) return undefined

    const { decision, note, itemId } = pendingDecisionForItem
    const frame = window.requestAnimationFrame(() => {
      setPendingDecision((current) => (current?.itemId === itemId ? null : current))
      setShowSubDialog(false)
      void onSubmit(item, sample, decision, note)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [canAct, pendingDecisionForItem, item, sample, onSubmit])

  const verdictStyle = item ? VERDICT_STYLE[item.verdict as keyof typeof VERDICT_STYLE] : null
  const VerdictIcon = verdictStyle?.Icon ?? null
  const decisionDisplay = getDecisionDisplay(item?.decision)
  const DecisionDisplayIcon = decisionDisplay?.Icon ?? null
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070c]/75 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (!isBusy && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-sample-title"
        className="w-[880px] max-w-[95vw] max-h-[90vh] overflow-y-auto overscroll-contain rounded-xl border border-[#343a4f] bg-[#171c27] shadow-[0_28px_90px_rgba(0,0,0,0.52)]"
      >
        {/* ── Header ── */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#343b50] bg-[#171c27]/95 px-6 py-5">
          <div className="min-w-0">
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-[#aeb7c8]">
              Verification Sample
            </p>
            <h2
              id="review-sample-title"
              className="truncate text-lg font-semibold text-[#edf0f7]"
            >
              {item ? `Sample #${item.sample_key.split('#').at(-1)}` : 'Loading…'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Close"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#aeb7c8] transition-[background-color,border-color,color,opacity] hover:border-[#343a4f] hover:bg-[#252b38] hover:text-[#edf0f7] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-[#aeb7c8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* ── Prev / Next navigation ── */}
          <div className="mb-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex <= 0 || isBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-[#343b50] bg-[#252b38] px-4 py-2 text-sm font-medium text-[#edf0f7] transition-[background-color,border-color,color] hover:border-[#60a5fa] hover:text-[#ffffff] disabled:cursor-default disabled:opacity-35 disabled:hover:border-[#343b50] disabled:hover:text-[#edf0f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
          >
            <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Prev
          </button>
          <span
            className="flex-1 text-center text-sm tabular-nums text-[#aeb7c8]"
            aria-live="polite"
          >
            {currentIndex + 1} / {totalCount}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={currentIndex >= totalCount - 1 || isBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-[#343b50] bg-[#252b38] px-4 py-2 text-sm font-medium text-[#edf0f7] transition-[background-color,border-color,color] hover:border-[#60a5fa] hover:text-[#ffffff] disabled:cursor-default disabled:opacity-35 disabled:hover:border-[#343b50] disabled:hover:text-[#edf0f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
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
              className="rounded-lg px-4 py-2 text-sm transition-[background-color,border-color,color] hover:border-[#60a5fa] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
              style={{ border: '1px solid #343b50', background: '#252b38', color: '#edf0f7' }}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* ── Detail grid ── */}
            <div className="mb-6 grid grid-cols-[132px_minmax(0,1fr)] gap-x-5 gap-y-3 rounded-lg border border-[#343b50] bg-[#111722] p-4 text-[15px]">
              <span className="pt-0.5 font-medium" style={{ color: '#aeb7c8' }}>
                Value
              </span>
              <span
                className="min-w-0 break-words font-mono text-sm"
                style={{ color: '#edf0f7' }}
              >
                {item.value}
              </span>

              <span className="pt-0.5 font-medium" style={{ color: '#aeb7c8' }}>
                Verdict
              </span>
              <span>
                {verdictStyle && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
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

              <span className="pt-0.5 font-medium" style={{ color: '#aeb7c8' }}>
                Reason
              </span>
              <span className="min-w-0 break-words" style={{ color: '#edf0f7' }}>
                {item.reason || '—'}
              </span>

              {item.suggested_label && (
                <>
                  <span className="pt-0.5 font-medium" style={{ color: '#aeb7c8' }}>
                    Suggested
                  </span>
                  <span
                    className="inline-block w-fit max-w-full rounded-md px-2.5 py-1 text-xs font-medium"
                    style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}
                  >
                    {item.suggested_label}
                  </span>
                </>
              )}

              {item.replacement_value && (
                <>
                  <span className="pt-0.5 font-medium" style={{ color: '#aeb7c8' }}>
                    Replacement
                  </span>
                  <span
                    className="inline-block w-fit max-w-full break-words rounded-md px-2.5 py-1 font-mono text-xs"
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
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div
                    className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: '#60a5fa' }}
                  >
                    <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                    Source Context
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      disabled={!hasLock || isBusy}
                      onClick={() => setShowMaskEditor((value) => !value)}
                      className="inline-flex items-center gap-2 rounded-lg border border-[#343b50] bg-[#252b38] px-3 py-1.5 text-sm font-medium text-[#edf0f7] transition-[background-color,border-color,color,opacity] hover:border-[#60a5fa] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#343b50] disabled:hover:text-[#edf0f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                      aria-expanded={showMaskEditor}
                    >
                      <Edit3 aria-hidden="true" className="h-3 w-3" />
                      {showMaskEditor ? 'Close editor' : 'Edit labels'}
                    </button>
                  )}
                </div>
                <div
                  ref={sourceContextRef}
                  className={cn(
                    'rounded-lg border border-[#343a4f] p-4 text-[15px] leading-8',
                    'max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words',
                    'review-source-context',
                  )}
                  style={{ background: '#111722', color: '#edf0f7' }}
                  dangerouslySetInnerHTML={{ __html: ctxHtml }}
                />
              </div>
            ) : acquiringLock ? (
              <div
                className="mb-5 flex items-center gap-2 rounded-lg border border-[#343b50] p-4 text-sm"
                style={{ background: '#252b38', color: '#aeb7c8' }}
              >
                <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
                Loading context…
              </div>
            ) : (
              <div
                className="mb-5 rounded-lg border border-[#343b50] p-4 text-sm italic"
                style={{ background: '#252b38', color: '#aeb7c8' }}
              >
                Context not available
              </div>
            )}

            {!readOnly && showMaskEditor && sample && sample.id === item.sample_row_id && (
              <SampleMaskEditor
                key={`${sample.id}:${sample.version}`}
                sample={sample}
                labelOptions={labelOptions}
                saving={saving}
                canEdit={hasLock && !isBusy}
                onClose={() => setShowMaskEditor(false)}
                onSave={(editingSample, sourceText, privacyMask) =>
                  onSaveSampleMask(item, editingSample, sourceText, privacyMask)
                }
              />
            )}

            {/* ── Reviewer note ── */}
            {readOnly ? (
              <div className="mb-5 rounded-lg border border-[#343b50] bg-[#252b38] p-4 text-sm">
                <div className="mb-1 font-medium text-[#aeb7c8]">Reviewer note</div>
                <div className="whitespace-pre-wrap break-words text-[#edf0f7]">
                  {item.reviewer_note || 'No note'}
                </div>
              </div>
            ) : (
              <div className="mb-5">
                <textarea
                  aria-label="Reviewer note"
                  name="reviewer-note"
                  autoComplete="off"
                  value={reviewerNote}
                  onChange={(e) => setReviewerNote(e.target.value)}
                  placeholder="Optional reviewer note…"
                  rows={3}
                  className="w-full resize-none rounded-lg px-3.5 py-2.5 text-[15px] transition-[border-color,background-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                  style={{
                    background: '#252b38',
                    border: '1px solid #343b50',
                    color: '#edf0f7',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#60a5fa')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#343b50')}
                />
              </div>
            )}

            {/* ── Action bar ── */}
            {readOnly ? (
              <div
                className="pt-4 flex items-center gap-3 flex-wrap"
                style={{ borderTop: '1px solid #343b50' }}
              >
                <span className="text-xs" style={{ color: '#aeb7c8' }}>
                  Decision:
                </span>
                {decisionDisplay ? (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: decisionDisplay.color }}
                  >
                    {DecisionDisplayIcon && (
                      <DecisionDisplayIcon aria-hidden="true" className="h-3.5 w-3.5" />
                    )}
                    {decisionDisplay.label}
                  </span>
                ) : (
                  <span className="text-xs uppercase tracking-wider text-[#aeb7c8]">
                    Not decided
                  </span>
                )}
                <span className="ml-auto text-xs tabular-nums" style={{ color: '#aeb7c8' }}>
                  {formatDateTime(item.decided_at ?? item.updated_at)}
                </span>
              </div>
            ) : (
                          <div
                            className="pt-4 flex items-center gap-3 flex-wrap"
                            style={{ borderTop: '1px solid #343b50' }}
                          >
                            <span className="text-xs" style={{ color: '#aeb7c8' }}>
                              Decision:
                            </span>
              
                            {/* Accept */}
                            {(() => {
                              // Allow click while lock is being acquired so the intent can be queued;
                              // truly disable only when saving (mid-submit) or genuinely unactionable.
                              const acceptQueued =
                                pendingDecisionForItem?.decision === 'accept'
                              const acceptClickable = canAct || (acquiringLock && !saving)
                              return (
                                <button
                                  type="button"
                                  disabled={!acceptClickable}
                                  onClick={() => {
                                    if (!sample || saving) return
                                    setShowSubDialog(false)
                                    if (canAct) {
                                      void onSubmit(item, sample, 'accept', reviewerNote)
                                    } else if (acquiringLock) {
                                      setPendingDecision({ decision: 'accept', note: reviewerNote, itemId: item.id })
                                    }
                                  }}
                                  className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-[15px] font-semibold transition-[background-color,border-color,color,opacity] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                                  style={{
                                    background: 'rgba(52,211,153,0.12)',
                                    color: '#34d399',
                                    border: '1px solid rgba(52,211,153,0.3)',
                                    opacity: canAct || acceptQueued ? 1 : acceptClickable ? 0.65 : 0.35,
                                    cursor: acceptClickable ? 'pointer' : 'not-allowed',
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
                                  {acceptQueued ? (
                                    <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                                  )}
                                  Accept
                                  {canAct && (
                                    <kbd
                                      className="ml-1 rounded px-1 py-0.5 text-[11px] font-normal"
                                      style={{
                                        border: '1px solid rgba(52,211,153,0.4)',
                                        opacity: 0.7,
                                      }}
                                    >
                                      Enter
                                    </kbd>
                                  )}
                                </button>
                              )
                            })()}
              
                            {/* Deny */}
                            {(() => {
                              const denySimple =
                                item.verdict !== 'UNREALISTIC_VALUE' && item.verdict !== 'WRONG_LABEL'
                              const denyQueued =
                                pendingDecisionForItem?.decision === 'deny'
                              // Only allow queueing for simple (no-subdialog) deny verdicts
                              const denyClickable = canAct || (denySimple && acquiringLock && !saving)
                              return (
                                <button
                                  type="button"
                                  disabled={!denyClickable}
                                  onClick={() => {
                                    if (!sample || saving) return
                                    if (item.verdict === 'UNREALISTIC_VALUE' || item.verdict === 'WRONG_LABEL') {
                                      if (canAct) setShowSubDialog((v) => !v)
                                    } else {
                                      setShowSubDialog(false)
                                      if (canAct) {
                                        void onSubmit(item, sample, 'deny', reviewerNote)
                                      } else if (acquiringLock) {
                                        setPendingDecision({ decision: 'deny', note: reviewerNote, itemId: item.id })
                                      }
                                    }
                                  }}
                                  className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-[15px] font-semibold transition-[background-color,border-color,color,opacity] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                                  style={{
                                    background: showSubDialog ? '#f87171' : 'rgba(248,113,113,0.12)',
                                    color: showSubDialog ? '#fff' : '#f87171',
                                    border: `1px solid ${showSubDialog ? '#f87171' : 'rgba(248,113,113,0.3)'}`,
                                    opacity: canAct || denyQueued ? 1 : denyClickable ? 0.65 : 0.35,
                                    cursor: denyClickable ? 'pointer' : 'not-allowed',
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
                                  {denyQueued ? (
                                    <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
                                  )}
                                  Deny
                                  {canAct && (
                                <kbd
                                  className="ml-1 rounded px-1 py-0.5 text-[11px] font-normal"
                                  style={{
                                    border: '1px solid rgba(248,113,113,0.4)',
                                    opacity: 0.7,
                                  }}
                                >
                                  Backspace
                                </kbd>
                              )}
                                </button>
                              )
                            })()}
              
                            {/* Already-reviewed status */}
                            {item.status === 'completed' && item.decision && (
                              <span
                                className="ml-auto inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider"
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
              
                            {acquiringLock && !saving && !pendingDecisionForItem && (
                              <span
                                className="ml-auto text-xs flex items-center gap-1.5"
                                style={{ color: '#60a5fa' }}
                              >
                                <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
                                Acquiring lock…
                              </span>
                            )}
              
                            {saving && (
                              <span className="ml-auto text-xs" style={{ color: '#fbbf24' }}>
                                Saving…
                              </span>
                            )}
                          </div>
            )}

            {/* ── Sub-dialog for multi-path deny decisions ── */}
            {!readOnly && showSubDialog && (
              <div
                className="mt-4 rounded-lg p-4 text-[15px]"
                style={{ background: '#252b38', border: '1px solid #343b50' }}
              >
                <p className="text-sm mb-3" style={{ color: '#aeb7c8' }}>
                  {item.verdict === 'WRONG_LABEL'
                    ? 'How should this wrong-label finding be denied?'
                    : 'What would you like to do with this sample?'}
                </p>
                <div className="flex gap-2">
                  {(
                    item.verdict === 'WRONG_LABEL'
                      ? ([
                          { label: 'Remove from PII mask', decision: 'deny_remove' as ReviewDecision },
                          { label: 'Keep current label', decision: 'deny' as ReviewDecision },
                        ] as const)
                      : ([
                          { label: 'Keep as-is', decision: 'deny_keep' as ReviewDecision },
                          { label: 'Remove label', decision: 'deny_remove' as ReviewDecision },
                        ] as const)
                  ).map(({ label, decision }) => (
                    <button
                      key={decision}
                      type="button"
                      onClick={() => {
                        setShowSubDialog(false)
                        if (sample) void onSubmit(item, sample, decision, reviewerNote)
                      }}
                      className="rounded-lg px-3.5 py-2 text-sm font-medium transition-[background-color,border-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
                      style={{
                        border: '1px solid #343b50',
                        background: '#191e2a',
                        color: '#edf0f7',
                      }}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background =
                          'rgba(96,165,250,0.1)'
                        ;(e.currentTarget as HTMLElement).style.borderColor = '#60a5fa'
                        ;(e.currentTarget as HTMLElement).style.color = '#60a5fa'
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = '#191e2a'
                        ;(e.currentTarget as HTMLElement).style.borderColor = '#343b50'
                        ;(e.currentTarget as HTMLElement).style.color = '#edf0f7'
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Lock status: only warn when we don't have the lock AND aren't in the process of getting it ── */}
            {!readOnly && !hasLock && !acquiringLock && sample?.locked_by && sample.locked_by !== currentUserId && (
              <p
                className="mt-3 flex items-center gap-1.5 text-xs"
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
