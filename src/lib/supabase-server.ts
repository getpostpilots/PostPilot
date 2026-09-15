import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { getCookies, setCookie, deleteCookie } from '@tanstack/react-start/server'

// Server-only clients. Never import from client code.

// Reads the auth cookie set by the browser client (lib/supabase.ts) so
// server functions know who's calling - respects RLS as that user.
export function supabaseServerClient() {
  return createServerClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        const all = getCookies()
        return Object.entries(all).map(([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          if (value === '') deleteCookie(name, options)
          else setCookie(name, value, options)
        }
      },
    },
  })
}

// Convenience: resolves the current user or throws. Use inside server fns.
export async function requireUser() {
  const client = supabaseServerClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return { user, supabase: client }
}

// Full-access client, bypasses RLS. Only for background jobs (the scheduler,
// the generation worker) that act on behalf of many users at once.
export function supabaseAdmin() {
  return createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}
