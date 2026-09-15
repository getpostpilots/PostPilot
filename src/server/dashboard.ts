import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { DEMO_MODE } from '../lib/demo-mode'
import { demoAccount, demoFounderPov, demoLogs, demoPillars, demoPosts, demoVoiceProfile, withPillar } from '../lib/demo-data'

// Aggregate read powering the Overview page: the active LinkedIn account (if
// any), its posts, pillars, voice profile, founder POV, and recent audit log.
export const getDashboard = createServerFn({ method: 'GET' }).handler(async () => {
  if (DEMO_MODE) {
    return {
      accounts: [{ ...demoAccount, content_pillars: demoPillars, voice_profiles: [demoVoiceProfile], founder_pov: demoFounderPov }],
      posts: demoPosts.map(withPillar),
      logs: demoLogs,
      stats: {
        published: demoPosts.filter((p) => p.state === 'published').length,
        queued: demoPosts.filter((p) => ['draft', 'approved', 'scheduled'].includes(p.state)).length,
      },
    }
  }

  const { user, supabase } = await requireUser()

  const [{ data: accounts }, { data: logs }] = await Promise.all([
    supabase
      .from('linkedin_accounts')
      .select(
        '*, content_pillars(*), voice_profiles(*), founder_pov(*)',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('decision_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const accountIds = (accounts ?? []).map((a) => a.id)
  const { data: posts } = accountIds.length
    ? await supabase
        .from('posts')
        .select('*, content_pillars(name, kind), campaigns(name)')
        .in('account_id', accountIds)
        .order('created_at', { ascending: false })
    : { data: [] }

  const stats = {
    published: (posts ?? []).filter((p) => p.state === 'published').length,
    queued: (posts ?? []).filter((p) => ['draft', 'approved', 'scheduled'].includes(p.state)).length,
  }

  return {
    accounts: accounts ?? [],
    posts: posts ?? [],
    logs: logs ?? [],
    stats,
  }
})

// Paginated audit trail read, separate from getDashboard's first-50 preview
// (used by Overview's "Recent activity" card) so the Audit trail page can
// page back through full history.
export const listDecisionLogs = createServerFn({ method: 'GET' })
  .validator((data: { offset: number; limit: number }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) return demoLogs.slice(data.offset, data.offset + data.limit)
    const { user, supabase } = await requireUser()
    const { data: rows, error } = await supabase
      .from('decision_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(data.offset, data.offset + data.limit - 1)
    if (error) throw new Error(error.message)
    return rows
  })
