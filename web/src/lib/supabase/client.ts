import { createClient } from '@supabase/supabase-js'
import type { Session } from '@supabase/supabase-js'
import { readRequiredEnv } from '../env'
import type { Database } from '../../types/database'

const supabaseUrl = readRequiredEnv('VITE_SUPABASE_URL')
const supabasePublishableKey = readRequiredEnv('VITE_SUPABASE_PUBLISHABLE_KEY')

const isPlaceholder =
  supabaseUrl.includes('<project-ref>') ||
  supabasePublishableKey.includes('...')

export const supabaseConfig = {
  url: supabaseUrl,
  isConfigured: Boolean(supabaseUrl && supabasePublishableKey && !isPlaceholder),
}

/**
 * Reads the Supabase session from localStorage synchronously without a
 * network round-trip. Supabase v2 persists the session under the key
 * `sb-<project-ref>-auth-token`. Returns null if the entry is absent,
 * malformed, or the access token has already expired.
 *
 * The async `getSession()` call in `useSession` still runs in the background
 * to refresh the token when needed — this is only used for instant initial
 * state so the loading screen is never shown for returning users.
 */
export function getStoredSession(): Session | null {
  if (!supabaseConfig.isConfigured) return null
  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`)
    if (!raw) return null
    const parsed: Session = JSON.parse(raw)
    if (!parsed?.access_token || !parsed?.expires_at) return null
    // expires_at is a Unix timestamp in seconds
    if (parsed.expires_at * 1000 < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

export const supabase = createClient<Database>(
  supabaseUrl || 'https://example.supabase.co',
  supabasePublishableKey || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
