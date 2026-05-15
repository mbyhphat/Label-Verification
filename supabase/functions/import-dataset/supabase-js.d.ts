/** Editor-only types for @supabase/supabase-js (runtime resolves via deno.json). */
declare module '@supabase/supabase-js' {
  export type PostgrestError = {
    message: string
    details?: string
    hint?: string
    code?: string
  }

  export type SupabaseClient = {
    auth: {
      getUser(jwt?: string): Promise<{
        data: { user: { id: string } | null }
        error: PostgrestError | null
      }>
    }
    rpc(
      fn: string,
      args?: Record<string, unknown>,
    ): Promise<{ data: unknown; error: PostgrestError | null }>
  }

  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: Record<string, unknown>,
  ): SupabaseClient
}
