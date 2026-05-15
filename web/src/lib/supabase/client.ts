import { createClient } from '@supabase/supabase-js'
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
