import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Check, XCircle } from 'lucide-react'
import type { ReviewItem, ReviewSample } from '@/types/domain'

type ReviewTableProps = {
  items: ReviewItem[]
  samplesById: Map<string, ReviewSample>
  activeItemId: string | null
  currentUserId: string
  onOpenItem: (item: ReviewItem) => void
}

type IconComponent = typeof Check

/** Shared by header row and data rows — absolute-positioned `<tr>` breaks table layout, so we use CSS Grid. */
const GRID_TEMPLATE_COLUMNS = 'minmax(88px, 12fr) minmax(120px, 18fr) minmax(140px, 38fr) minmax(104px, 14fr) minmax(92px, 12fr) minmax(52px, 6fr)'

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

const ESTIMATE_ROW_HEIGHT = 41

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

const TH_STYLE: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '2px solid #2e3345',
  color: '#9ca3b8',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  fontSize: '10px',
  whiteSpace: 'nowrap',
  userSelect: 'none',
}

const HEADER_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
  width: '100%',
  alignItems: 'center',
}

function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === 'Enter' || event.key === ' '
}

export function ReviewTable({
  items,
  samplesById,
  activeItemId,
  currentUserId,
  onOpenItem,
}: ReviewTableProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATE_ROW_HEIGHT,
    overscan: 5,
  })

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="rounded-md border border-border/80 bg-card px-4 py-3 text-sm text-muted-foreground">
          No items match the current filter.
        </p>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-auto bg-background">
      <div style={{ width: '100%', minWidth: '780px', fontSize: '12px' }}>
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: '#0f1117',
            borderBottom: '2px solid #2e3345',
          }}
        >
          <div role="row" style={HEADER_GRID_STYLE}>
            <div role="columnheader" style={TH_STYLE}>
              Sample
            </div>
            <div role="columnheader" style={TH_STYLE}>
              Class
            </div>
            <div role="columnheader" style={TH_STYLE}>
              Value
            </div>
            <div role="columnheader" style={TH_STYLE}>
              Verdict
            </div>
            <div role="columnheader" style={TH_STYLE}>
              Status
            </div>
            <div role="columnheader" style={TH_STYLE}>
              Lock
            </div>
          </div>
        </div>

        <div
          role="presentation"
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
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
                aria-label={`Open sample ${item.sample_key.split('#').at(-1)} for ${item.value}`}
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
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
                  alignItems: 'center',
                  borderBottom: '1px solid #2e3345',
                  cursor: 'pointer',
                  background: rowBg,
                  transition: 'background 0.1s',
                  boxSizing: 'border-box',
                  boxShadow: isActive ? 'inset 3px 0 0 #60a5fa' : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = '#1a1d27'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = rowBg
                }}
              >
                <div
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#9ca3b8',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.sample_key.split('#').at(-1)}
                </div>

                <div
                  style={{
                    padding: '8px 10px',
                    fontSize: '11px',
                    fontWeight: 500,
                    color: '#9ca3b8',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.entity_type}
                </div>

                <div
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#e4e6ed',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.value}
                </div>

                <div style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  {badge && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                        background: badge.bg,
                        color: badge.color,
                        border: `1px solid ${badge.border}`,
                      }}
                    >
                      {BadgeIcon && <BadgeIcon aria-hidden="true" className="h-3 w-3" />}
                      {badge.label}
                    </span>
                  )}
                </div>

                <div style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  {decisionLabel ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                        color: decisionLabel.color,
                      }}
                    >
                      {DecisionIcon && (
                        <DecisionIcon aria-hidden="true" className="h-3 w-3" />
                      )}
                      {decisionLabel.label}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#9ca3b8',
                        textTransform: 'capitalize',
                      }}
                    >
                      {item.status}
                    </span>
                  )}
                </div>

                <div style={{ padding: '8px 10px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 500,
                      color:
                        lockLabel === 'Yours'
                          ? '#e4e6ed'
                          : lockLabel === 'Locked'
                            ? '#f87171'
                            : '#9ca3b8',
                    }}
                  >
                    {lockLabel}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
