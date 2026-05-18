import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { LogOut, ShieldCheck } from 'lucide-react'

type AppHeaderProps = {
  canShowAdmin: boolean
  onSignOut: () => void
  stats?: ReactNode
  actions?: ReactNode
}

export function AppHeader({ canShowAdmin, onSignOut, stats, actions }: AppHeaderProps) {
  return (
    <header
      className="flex h-[64px] shrink-0 items-center justify-between gap-5 px-6"
      style={{ background: '#191e2a', borderBottom: '1px solid #343b50' }}
    >
      <div className="flex min-w-0 items-center gap-4 overflow-hidden">
        <span className="inline-flex shrink-0 items-center gap-2.5 text-base font-bold text-[#edf0f7]">
          <ShieldCheck aria-hidden="true" className="h-5 w-5 text-[#60a5fa]" />
          PII Verification
        </span>

        <nav className="flex shrink-0 items-center gap-1.5 text-sm">
          <HeaderLink to="/">Review</HeaderLink>
          {canShowAdmin && <HeaderLink to="/admin">Admin</HeaderLink>}
        </nav>

        {stats}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex items-center gap-2 rounded-lg border border-transparent px-3.5 py-2 text-sm font-medium text-[#aeb7c8] transition-[background-color,border-color,color] hover:border-[#343b50] hover:bg-[#252b38] hover:text-[#edf0f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </header>
  )
}

function HeaderLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'rounded-lg px-3 py-2 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]',
          isActive ? 'bg-[#252b38] text-[#edf0f7]' : 'text-[#aeb7c8] hover:bg-[#252b38] hover:text-[#edf0f7]',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  )
}
