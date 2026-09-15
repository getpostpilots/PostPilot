import { createBrowserClient } from '@supabase/ssr'

// Browser client - session is synced into cookies (not just localStorage) so
// server functions can read the same session via lib/supabase-server.ts.
export const supabase = createBrowserClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
