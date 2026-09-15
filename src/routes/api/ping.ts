import { createFileRoute } from '@tanstack/react-router'
import { ensureSchedulerRunning } from '../../server/scheduler'

// Hit by an external cron/uptime service (e.g. cron-job.org) every few
// minutes in production. Two jobs in one: keeps Render's free-tier instance
// from spinning down on idle, and - since this is a real server-side
// request, unlike the client useEffect in routes/app/route.tsx - guarantees
// the in-process scheduler actually gets (re)started after a fresh deploy
// or a spin-down/restart, without anyone needing to open the app first.
export const Route = createFileRoute('/api/ping')({
  server: {
    handlers: {
      GET: () => {
        ensureSchedulerRunning()
        return new Response('ok')
      },
    },
  },
})
