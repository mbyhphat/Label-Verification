import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Check, XCircle } from 'lucide-react'
import type { ReviewItem, ReviewSample } from '@/types/domain'

export type ReviewTableMode = 'review' | 'labeled'

type ReviewTableProps = {
  mode?: ReviewTableMode
  items: ReviewItem[]
  samplesById: Map<string, ReviewSample>
  activeItemId: string | null
  currentUserId: string
  onOpenItem: (item: ReviewItem) => void
}

type IconComponent = typeof Check

const REVIEW_GRID_TEMPLATE_COLUMNS =
  'minmax(116px, 12fr) minmax(144px, 18fr) minmax(220px, 38fr) minmax(124px, 14fr) minmax(112px, 12fr) minmax(72px, 6fr)'
const LABELED_GRID_TEMPLATE_COLUMNS =
  'minmax(150px, 14fr) minmax(144px, 16fr) minmax(220px, 34fr) minmax(124px, 13fr) minmax(124px, 12fr) minmax(116px, 10fr)'

const VERDICT_BADGE: Record<
  string,
  { bg: string; color: string; border: string; label: string; Icon: IconComponent }
> = {
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
    label: 'Wrong',
    Icon: XCircle,
  },
  UNREALISTIC_VALUE: {
    bg: 'rgba(251,191,36,0.12)',
    color: '#fbbf24',
    border: 'rgba(251,191,36,0.3)',
    label: 'Unrealistic',
    Icon: AlertTriangle,
  },
}

const ESTIMATE_ROW_HEIGHT = 54

function getLockLabel(sample: ReviewSample | undefined, userId: string): string {
  if (!sample?.locked_by || !sample.locked_until) return 'Free'
  if (new Date(sample.locked_until).getTime() < Date.now()) return 'Expired'
  return sample.locked_by === userId ? 'Yours' : 'Locked'
}

function getDecisionLabel(
  decision: string | null | undefined,
): { label: string; color: string; Icon: IconComponent } | null {
  if (!decision) return null
  if (decision === 'accept') return { label: 'Accepted', color: '#34d399', Icon: Check }
  if (decision === 'deny_keep') return { label: 'Kept', color: '#f87171', Icon: XCircle }
  if (decision === 'deny_remove') return { label: 'Removed', color: '#f87171', Icon: XCircle }
  return { label: 'Denied', color: '#f87171', Icon: XCircle }
}

function formatLabeledAt(decidedAt: string | null, updatedAt: string): string {
  const raw = decidedAt ?? updatedAt
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const TH_STYLE: CSSProperties = {
  textAlign: 'left',
  padding: '11px 12px',
  borderBottom: '2px solid #343b50',
  color: '#aeb7c8',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0,
  fontSize: '13px',
  whiteSpace: 'nowrap',
  userSelect: 'none',
}

const CELL_STYLE: CSSProperties = {
  padding: '11px 12px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === 'Enter' || event.key === ' '
}

export function ReviewTable({
  mode = 'review',
  items,
  samplesById,
  activeItemId,
  currentUserId,
  onOpenItem,
}: ReviewTableProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const gridTemplateColumns =
    mode === 'labeled' ? LABELED_GRID_TEMPLATE_COLUMNS : REVIEW_GRID_TEMPLATE_COLUMNS

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATE_ROW_HEIGHT,
    overscan: 5,
  })

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="rounded-lg border border-border/80 bg-card px-5 py-4 text-base text-muted-foreground">
          {mode === 'labeled'
            ? 'No labeled items match the current filter.'
            : 'No items match the current filter.'}
        </p>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-auto bg-background">
      <div style={{ width: '100%', minWidth: '960px', fontSize: '14px' }}>
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: '#0d1017',
            borderBottom: '2px solid #343b50',
          }}
        >
          <div
            role="row"
            style={{
              display: 'grid',
              gridTemplateColumns,
              width: '100%',
              alignItems: 'center',
            }}
          >
            {mode === 'labeled' ? (
              <>
                <div role="columnheader" style={TH_STYLE}>Labeled at</div>
                <div role="columnheader" style={TH_STYLE}>Class</div>
                <div role="columnheader" style={TH_STYLE}>Value</div>
                <div role="columnheader" style={TH_STYLE}>Verdict</div>
                <div role="columnheader" style={TH_STYLE}>Decision</div>
                <div role="columnheader" style={TH_STYLE}>Sample</div>
              </>
            ) : (
              <>
                <div role="columnheader" style={TH_STYLE}>Sample</div>
                <div role="columnheader" style={TH_STYLE}>Class</div>
                <div role="columnheader" style={TH_STYLE}>Value</div>
                <div role="columnheader" style={TH_STYLE}>Verdict</div>
                <div role="columnheader" style={TH_STYLE}>Status</div>
                <div role="columnheader" style={TH_STYLE}>Lock</div>
              </>
            )}
          </div>
        </div>

        <div
          role="presentation"
          style={{
            height: rowVirtualizer.getTotalSize() + 'px',
            position: 'relative',
            width: '100%',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index]
            const sample = samplesById.get(item.sample_row_id)
            const lockLabel = getLockLabel(sample, currentUserId)
            const badge = VERDICT_BADGE[item.verdict]
            const decisionLabel = getDecisionLabel(item.decision)
            const isActive = activeItemId === item.id
            const BadgeIcon = badge?.Icon
            const DecisionIcon = decisionLabel?.Icon

            const rowBg = isActive
              ? 'rgba(96,165,250,0.08)'
              : item.decision === 'accept'
                ? 'rgba(52,211,153,0.04)'
                : item.decision
                  ? 'rgba(248,113,113,0.04)'
                  : 'transparent'

            return (
              <div
                key={item.id}
                role="button"
                data-index={virtualRow.index}
                tabIndex={0}
                aria-label={
                  (mode === 'labeled' ? 'Open labeled sample ' : 'Open sample ') +
                  item.sample_key.split('#').at(-1) +
                  ' for ' +
                  item.value
                }
                onClick={() => onOpenItem(item)}
                onKeyDown={(event) => {
                  if (!isActivationKey(event)) return
                  event.preventDefault()
                  onOpenItem(item)
                }}
                className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#60a5fa]"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size + 'px',
                  transform: 'translateY(' + virtualRow.start + 'px)',
                  display: 'grid',
                  gridTemplateColumns,
                  alignItems: 'center',
                  borderBottom: '1px solid #343b50',
                  cursor: 'pointer',
                  background: rowBg,
                  transition: 'background 0.1s',
                  boxSizing: 'border-box',
                  boxShadow: isActive ? 'inset 3px 0 0 #60a5fa' : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = '#191e2a'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = rowBg
                }}
              >
                {mode === 'labeled' ? (
                  <div
                    style={{
                      ...CELL_STYLE,
                      fontSize: '13px',
                      color: '#aeb7c8',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatLabeledAt(item.decided_at, item.updated_at)}
                  </div>
                ) : (
                  <div
                    style={{
                      ...CELL_STYLE,
                      fontFamily: 'monospace',
                      fontSize: '13px',
                      color: '#aeb7c8',
                    }}
                  >
                    {item.sample_key.split('#').at(-1)}
                  </div>
                )}

                <div
                  style={{
                    ...CELL_STYLE,
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#aeb7c8',
                  }}
                >
                  {item.entity_type}
                </div>

                <div
                  style={{
                    ...CELL_STYLE,
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    color: '#edf0f7',
                  }}
                >
                  {item.value}
                </div>

                <div style={{ padding: '11px 12px', whiteSpace: 'nowrap' }}>
                  {badge && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: 0,
                        background: badge.bg,
                        color: badge.color,
                        border: '1px solid ' + badge.border,
                      }}
                    >
                      {BadgeIcon && <BadgeIcon aria-hidden="true" className="h-3.5 w-3.5" />}
                      {badge.label}
                    </span>
                  )}
                </div>

                <div style={{ padding: '11px 12px', whiteSpace: 'nowrap' }}>
                  {decisionLabel ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '13px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: 0,
                        color: decisionLabel.color,
                      }}
                    >
                      {DecisionIcon && (
                        <DecisionIcon aria-hidden="true" className="h-3.5 w-3.5" />
                      )}
                      {decisionLabel.label}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '13px',
                        color: '#aeb7c8',
                        textTransform: 'capitalize',
                      }}
                    >
                      {item.status}
                    </span>
                  )}
                </div>

                {mode === 'labeled' ? (
                  <div
                    style={{
                      ...CELL_STYLE,
                      fontFamily: 'monospace',
                      fontSize: '13px',
                      color: '#aeb7c8',
                    }}
                  >
                    {item.sample_key.split('#').at(-1)}
                  </div>
                ) : (
                  <div style={{ padding: '11px 12px' }}>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color:
                          lockLabel === 'Yours'
                            ? '#edf0f7'
                            : lockLabel === 'Locked'
                              ? '#f87171'
                              : '#aeb7c8',
                      }}
                    >
                      {lockLabel}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
