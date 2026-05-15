import type { CSSProperties, KeyboardEvent } from 'react'
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
  position: 'sticky',
  top: 0,
  background: '#0f1117',
  whiteSpace: 'nowrap',
  userSelect: 'none',
}

function isActivationKey(event: KeyboardEvent<HTMLTableRowElement>): boolean {
  return event.key === 'Enter' || event.key === ' '
}

export function ReviewTable({
  items,
  samplesById,
  activeItemId,
  currentUserId,
  onOpenItem,
}: ReviewTableProps) {
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
    <div className="flex-1 overflow-auto bg-background">
      <table
        style={{
          width: '100%',
          minWidth: '780px',
          borderCollapse: 'collapse',
          fontSize: '12px',
        }}
      >
        <thead>
          <tr>
            <th style={TH_STYLE}>Sample</th>
            <th style={TH_STYLE}>Class</th>
            <th style={TH_STYLE}>Value</th>
            <th style={TH_STYLE}>Verdict</th>
            <th style={TH_STYLE}>Status</th>
            <th style={TH_STYLE}>Lock</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const sample = samplesById.get(item.sample_row_id)
            const lockLabel = getLockLabel(sample, currentUserId)
            const badge = VERDICT_BADGE[item.verdict]
            const decisionLabel = getDecisionLabel(item.decision)
            const isActive = activeItemId === item.id
            const BadgeIcon = badge?.Icon
            const DecisionIcon = decisionLabel?.Icon

            // Row background based on decision + active state
            const rowBg = isActive
              ? 'rgba(96,165,250,0.08)'
              : item.decision === 'accept'
                ? 'rgba(52,211,153,0.04)'
                : item.decision
                  ? 'rgba(248,113,113,0.04)'
                  : 'transparent'

            return (
              <tr
                key={item.id}
                aria-label={`Open sample ${item.sample_key.split('#').at(-1)} for ${item.value}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpenItem(item)}
                onKeyDown={(event) => {
                  if (!isActivationKey(event)) return
                  event.preventDefault()
                  onOpenItem(item)
                }}
                className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#60a5fa]"
                style={{
                  borderBottom: '1px solid #2e3345',
                  cursor: 'pointer',
                  background: rowBg,
                  transition: 'background 0.1s',
                  boxShadow: isActive ? 'inset 3px 0 0 #60a5fa' : undefined,
                  contentVisibility: 'auto',
                  containIntrinsicSize: '40px',
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.background = '#1a1d27'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = rowBg
                }}
              >
                {/* Sample ID */}
                <td
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#9ca3b8',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.sample_key.split('#').at(-1)}
                </td>

                {/* Class */}
                <td
                  style={{
                    padding: '8px 10px',
                    fontSize: '11px',
                    fontWeight: 500,
                    color: '#9ca3b8',
                    maxWidth: '160px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.entity_type}
                </td>

                {/* Value */}
                <td
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#e4e6ed',
                    maxWidth: '180px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.value}
                </td>

                {/* Verdict badge */}
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
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
                </td>

                {/* Status / decision */}
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
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
                </td>

                {/* Lock */}
                <td style={{ padding: '8px 10px' }}>
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
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
