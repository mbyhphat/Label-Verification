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
      className="flex h-[52px] shrink-0 items-center justify-between gap-4 px-5"
      style={{ background: '#1a1d27', borderBottom: '1px solid #2e3345' }}
    >
      <div className="flex min-w-0 items-center gap-4 overflow-hidden">
        <span className="inline-flex shrink-0 items-center gap-2 text-[14px] font-bold text-[#e4e6ed]">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-[#60a5fa]" />
          PII Verification
        </span>

        <nav className="flex shrink-0 items-center gap-1 text-[12px]">
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
          className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-[12px] text-[#9ca3b8] transition-[background-color,border-color,color] hover:border-[#2e3345] hover:bg-[#232733] hover:text-[#e4e6ed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
        >
          <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
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
          'rounded-md px-2.5 py-1.5 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]',
          isActive ? 'bg-[#232733] text-[#e4e6ed]' : 'text-[#9ca3b8] hover:bg-[#232733] hover:text-[#e4e6ed]',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  )
}
