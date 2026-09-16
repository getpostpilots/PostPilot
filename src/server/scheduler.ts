import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { runDueCampaigns } from './campaign-engine'
import { runDueScheduledPosts } from './posts'
import { DEMO_MODE } from '../lib/demo-mode'

const TICK_MS = 5 * 60 * 1000 // 5 minutes

// In-process scheduler: no deployed server exists yet, so this only runs
// for as long as the Node process stays alive - a Render free-tier
// spin-down or a local terminal close pauses scheduled campaigns until
// something (routes/api/ping.ts, or the client useEffect below) starts it
// again. Guarded on globalThis (not a module-level let) so dev-mode HMR,
// which can re-evaluate this module without restarting the process, can't
// spin up a second interval.
//
// Wrapped in createServerOnlyFn (not a plain exported function) because
// this module gets imported from routes/app/route.tsx, which is shared
// client/server code - without this wrapper, the bundler pulled this
// function's whole import chain (down to genuinely server-only cookie/Node
// APIs in supabase-server.ts) into the client bundle and broke the build.
export const ensureSchedulerRunning = createServerOnlyFn(() => {
  if (DEMO_MODE) return
  const g = globalThis as any
  if (g.__postpilotSchedulerStarted) return
  g.__postpilotSchedulerStarted = true

  const tick = () => {
    runDueCampaigns().catch((err) => console.error('Scheduler tick failed:', err))
    runDueScheduledPosts().catch((err) => console.error('Scheduler tick failed:', err))
  }
  tick()
  setInterval(tick, TICK_MS)
})

// Called once from the client on app load (see routes/app/route.tsx) purely
// to trigger this module's server-side execution - createServerFn's
// handler body never ships to the browser bundle. Belt-and-suspenders
// alongside the /api/ping route, which is the one a cron service can hit.
export const startScheduler = createServerFn({ method: 'POST' }).handler(async () => {
  ensureSchedulerRunning()
  return { ok: true }
})
