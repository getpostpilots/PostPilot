import { useEffect, useState } from 'react'
import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { AuthForm } from '../../components/auth-form'
import { cn } from '../../lib/utils'
import { DEMO_MODE } from '../../lib/demo-mode'
import { startScheduler } from '../../server/scheduler'

export const Route = createFileRoute('/app')({ component: AppLayout })

const NAV = [
  { to: '/app', label: 'Overview' },
  { to: '/app/new-post', label: 'New post' },
  { to: '/app/scheduled', label: 'Scheduled posts' },
  { to: '/app/published', label: 'Published posts' },
  { to: '/app/campaigns', label: 'Campaigns' },
  { to: '/app/image-library', label: 'Image library' },
  { to: '/app/decisions', label: 'Audit trail' },
  { to: '/app/setup', label: 'Configuration' },
] as const

function AppLayout() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!DEMO_MODE)
  const location = useLocation()

  // Pings the server once so server/scheduler.ts's in-process timer starts.
  // It then keeps running in the Node process regardless of this tab.
  useEffect(() => {
    startScheduler().catch(() => {})
  }, [])

  useEffect(() => {
    if (DEMO_MODE) return
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading...</div>
  }

  if (!DEMO_MODE && !session) return <AuthForm />

  return (
    <div className="grid min-h-screen md:grid-cols-[220px_1fr]">
      <aside className="border-b bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="mb-4 px-2 text-sm font-semibold tracking-widest text-sidebar-foreground md:mb-8">POSTPILOT</div>
        {DEMO_MODE && (
          <div className="mb-4 rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
            Demo mode - sample data only, nothing is saved or posted for real.
          </div>
        )}
        {/* Horizontally scrollable pill row on phones, vertical list from md up */}
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:overflow-visible md:px-0 md:pb-0">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'shrink-0 rounded-md px-3 py-2 text-sm whitespace-nowrap text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                location.pathname === item.to && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {!DEMO_MODE && (
          <button
            type="button"
            className="mt-4 px-3 text-left text-xs text-muted-foreground underline underline-offset-4 md:mt-auto md:pt-8"
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        )}
      </aside>
      <main className="min-w-0 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  )
}
