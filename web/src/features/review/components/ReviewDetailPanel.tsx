import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ReviewDecision, ReviewItem, ReviewSample } from '@/types/domain'
import { buildDecisionPreview, recommendedDecision } from '../utils/review.service'
import {
  buildHighlightedSourceHtml,
  scrollHighlightedTextIntoView,
} from '../utils/highlight-source'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type ReviewDetailPanelProps = {
  item: ReviewItem | null
  sample: ReviewSample | null
  currentUserId: string
  saving: boolean
  onSubmitDecision: (
    item: ReviewItem,
    sample: ReviewSample,
    decision: ReviewDecision,
    reviewerNote: string,
  ) => Promise<void>
  onReleaseLock: (sampleId: string) => Promise<void>
}

const DECISION_OPTIONS: { value: ReviewDecision; label: string }[] = [
  { value: 'accept', label: 'Accept generated label' },
  { value: 'deny_keep', label: 'Deny – keep span, correct label' },
  { value: 'deny_remove', label: 'Deny – remove span from mask' },
  { value: 'deny', label: 'Deny – replace text if replacement exists' },
]

function isOwnLock(sample: ReviewSample | null, userId: string): boolean {
  if (!sample?.locked_by || !sample.locked_until) return false
  return sample.locked_by === userId && new Date(sample.locked_until).getTime() > Date.now()
}

export function ReviewDetailPanel({
  item,
  sample,
  currentUserId,
  saving,
  onSubmitDecision,
  onReleaseLock,
}: ReviewDetailPanelProps) {
  const [decision, setDecision] = useState<ReviewDecision>('accept')
  const [reviewerNote, setReviewerNote] = useState('')
  const sourceRef = useRef<HTMLDivElement>(null)

  const recommended = item ? recommendedDecision(item) : 'accept'
  const hasLock = isOwnLock(sample, currentUserId)

  const preview = useMemo(() => {
    if (!sample || !item) return null
    return buildDecisionPreview(sample, item, decision)
  }, [decision, item, sample])

  const highlightedSource = useMemo(() => {
    if (!sample || !item) return ''
    return buildHighlightedSourceHtml(sample.current_source_text, item, sample.current_privacy_mask)
  }, [item, sample])

  useEffect(() => {
    if (!highlightedSource) return undefined
    return scrollHighlightedTextIntoView(sourceRef.current)
  }, [highlightedSource])

  if (!item || !sample) {
    return (
      <aside className="w-80 shrink-0 border-l border-border/80 bg-card/95 flex flex-col items-center justify-center gap-2 text-center px-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Review
        </p>
        <h2 className="text-base font-semibold text-foreground">Select an item</h2>
        <p className="text-sm text-muted-foreground">
          Open a pending row to acquire its sample lock.
        </p>
      </aside>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!item || !sample) return
    await onSubmitDecision(item, sample, decision, reviewerNote)
    setReviewerNote('')
  }

  const detailRows = [
    { label: 'Class', value: item.entity_type },
    { label: 'Verdict', value: item.verdict.replace(/_/g, ' ') },
    { label: 'Suggested label', value: item.suggested_label || '—' },
    { label: 'Replacement', value: item.replacement_value || '—' },
    { label: 'Reason', value: item.reason || '—' },
  ]

  return (
    <aside className="w-80 shrink-0 border-l border-border/80 bg-card/95 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border/80 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
            Sample {sample.sample_index}
          </p>
          <h2 className="text-sm font-semibold text-foreground truncate">{item.value}</h2>
        </div>
        <Badge variant={hasLock ? 'default' : 'outline'} className="shrink-0 mt-0.5 text-[11px]">
          {hasLock ? 'Locked by you' : 'No lock'}
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div
          ref={sourceRef}
          className={cn(
            'mx-3 mt-3 rounded-md border border-border/80 bg-background/65 px-3 py-3',
            'max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-foreground',
            'review-source-context',
          )}
          dangerouslySetInnerHTML={{ __html: highlightedSource }}
        />

        <dl className="px-4 py-4 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border/80">
          {detailRows.map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                {label}
              </dt>
              <dd className="break-words text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>

        <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="decision">Decision</Label>
            <Select value={decision} onValueChange={(v) => setDecision(v as ReviewDecision)}>
              <SelectTrigger id="decision" className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECISION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Recommended:{' '}
              <span className="font-medium text-foreground">{recommended}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              name="reviewer-note"
              autoComplete="off"
              rows={3}
              placeholder="Optional reviewer note…"
              value={reviewerNote}
              onChange={(e) => setReviewerNote(e.target.value)}
              className="resize-none text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Preview mask
            </p>
            <pre
              className={cn(
                'rounded border border-border bg-muted p-2.5 text-[11px] font-mono',
                'max-h-36 overflow-auto text-muted-foreground whitespace-pre-wrap break-all',
              )}
            >
              {JSON.stringify(preview?.privacyMask ?? [], null, 2)}
            </pre>
          </div>

          <Separator />

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={!hasLock || saving}
              onClick={() => onReleaseLock(sample.id)}
            >
              Release
            </Button>
            <Button type="submit" size="sm" className="flex-1" disabled={!hasLock || saving}>
              {saving ? 'Saving…' : 'Submit'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  )
}
