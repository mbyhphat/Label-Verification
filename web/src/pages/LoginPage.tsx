import { type FormEvent, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { formatSupabaseError } from '@/lib/supabase/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setMessage('')

    if (mode === 'magic') {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      setLoading(false)
      setMessage(error ? formatSupabaseError(error) : 'Check your email for the login link.')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setMessage(formatSupabaseError(error))
  }

  return (
    <div className="min-h-svh flex">
      <div className="hidden lg:flex flex-col justify-between w-80 shrink-0 border-r border-border bg-muted/30 px-8 py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-8">
            PII Verification
          </p>
          <h1 className="text-2xl font-semibold leading-snug text-foreground">
            Collaborative label review with locks &amp; audit history.
          </h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Sign in with a Supabase user added to{' '}
          <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">project_members</code>.
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden space-y-1 mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              PII Verification
            </p>
            <h1 className="text-xl font-semibold text-foreground">Sign in to continue</h1>
          </div>

          <div
            className="inline-flex rounded-md border border-border p-0.5 bg-muted/50 w-full"
            role="tablist"
            aria-label="Login mode"
          >
            {(['password', 'magic'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
                  mode === m
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'password' ? 'Password' : 'Magic link'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="reviewer@company.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {mode === 'password' ? (
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>

            {message ? (
              <p
                className={cn(
                  'text-sm',
                  message.toLowerCase().includes('check')
                    ? 'text-muted-foreground'
                    : 'text-destructive',
                )}
              >
                {message}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  )
}
