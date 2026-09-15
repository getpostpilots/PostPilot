import { createServerFn } from '@tanstack/react-start'
import { runDueCampaigns } from './campaign-engine'
import { DEMO_MODE } from '../lib/demo-mode'

const TICK_MS = 5 * 60 * 1000 // 5 minutes

// In-process scheduler: no deployed server exists yet, so this only runs
// for as long as `npm run dev`'s Node process stays alive - closing the
// terminal/laptop pauses scheduled campaigns until it's started again.
// Guarded on globalThis (not a module-level let) so Vite's dev-mode HMR,
// which can re-evaluate this module without restarting the process, can't
// spin up a second interval.
// Exported (not just called internally) so both startScheduler below and
// routes/api/ping.ts's plain HTTP handler can trigger it - the ping route is
// what actually matters in production, since a cron service hitting it is a
// real request with no browser/JS involved, unlike the client useEffect.
export function ensureSchedulerRunning() {
  if (DEMO_MODE) return
  const g = globalThis as any
  if (g.__postpilotSchedulerStarted) return
  g.__postpilotSchedulerStarted = true

  const tick = () => {
    runDueCampaigns().catch((err) => console.error('Scheduler tick failed:', err))
  }
  tick()
  setInterval(tick, TICK_MS)
}

// Called once from the client on app load (see routes/app/route.tsx) purely
// to trigger this module's server-side execution - createServerFn's
// handler body never ships to the browser bundle. Belt-and-suspenders
// alongside the /api/ping route, which is the one a cron service can hit.
export const startScheduler = createServerFn({ method: 'POST' }).handler(async () => {
  ensureSchedulerRunning()
  return { ok: true }
})
