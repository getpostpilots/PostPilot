import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { DEMO_MODE } from '../lib/demo-mode'
import { demoAccount, demoFounderPov, demoLogs, demoPillars, demoPosts, demoVoiceProfile, withPillar } from '../lib/demo-data'

// Aggregate read powering most pages: the active LinkedIn account (if any),
// its pillars/voice/founder POV, publish stats, and a recent audit-log
// preview. Deliberately does NOT include posts - that grows unboundedly as
// drafts/campaigns pile up, and this used to fetch every post ever made on
// every single page navigation. Pages that need post rows call listPosts
// below with the specific slice they actually need.
export const getDashboard = createServerFn({ method: 'GET' }).handler(async () => {
  if (DEMO_MODE) {
    return {
      accounts: [{ ...demoAccount, content_pillars: demoPillars, voice_profiles: [demoVoiceProfile], founder_pov: demoFounderPov }],
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
      .select('*, content_pillars(*), voice_profiles(*), founder_pov(*)')
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
  const [{ count: published }, { count: queued }] = accountIds.length
    ? await Promise.all([
        supabase.from('posts').select('id', { count: 'exact', head: true }).in('account_id', accountIds).eq('state', 'published'),
        supabase.from('posts').select('id', { count: 'exact', head: true }).in('account_id', accountIds).in('state', ['draft', 'approved', 'scheduled']),
      ])
    : [{ count: 0 }, { count: 0 }]

  return {
    accounts: accounts ?? [],
    logs: logs ?? [],
    stats: { published: published ?? 0, queued: queued ?? 0 },
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

// Targeted post reads for Scheduled/Published pages - each asks for exactly
// the states and page size it needs, instead of every page pulling the
// account's entire post history.
export const listPosts = createServerFn({ method: 'GET' })
  .validator((data: { accountId: string; states: string[]; orderBy?: 'created_at' | 'published_at'; offset?: number; limit: number }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const filtered = demoPosts.filter((p) => data.states.includes(p.state)).map(withPillar)
      const offset = data.offset ?? 0
      return filtered.slice(offset, offset + data.limit)
    }
    const { supabase } = await requireUser()
    const { data: rows, error } = await supabase
      .from('posts')
      .select('*, content_pillars(name, kind), campaigns(name)')
      .eq('account_id', data.accountId)
      .in('state', data.states)
      .order(data.orderBy ?? 'created_at', { ascending: false })
      .range(data.offset ?? 0, (data.offset ?? 0) + data.limit - 1)
    if (error) throw new Error(error.message)
    return rows
  })

async function firstAccount(userId: string, supabase: Awaited<ReturnType<typeof requireUser>>['supabase']) {
  const { data } = await supabase.from('linkedin_accounts').select('*').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle()
  return data
}

// Combined reads for pages that were doing "fetch account, then fetch data
// scoped to that account" as two sequential network round-trips - each of
// those doubled the page's load latency for no reason, since the account
// lookup and the follow-up query don't need the client in between them.
export const getScheduledPageData = createServerFn({ method: 'GET' }).handler(async () => {
  if (DEMO_MODE) {
    return {
      account: { ...demoAccount, timezone: demoAccount.timezone },
      posts: demoPosts.filter((p) => ['draft', 'approved', 'scheduled', 'failed'].includes(p.state)).map(withPillar),
      campaigns: [],
    }
  }
  const { user, supabase } = await requireUser()
  const account = await firstAccount(user.id, supabase)
  if (!account) return { account: null, posts: [], campaigns: [] }

  const [{ data: posts }, { data: campaigns }] = await Promise.all([
    supabase
      .from('posts')
      .select('*, content_pillars(name, kind), campaigns(name)')
      .eq('account_id', account.id)
      .in('state', ['draft', 'approved', 'scheduled', 'failed'])
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('campaigns').select('*, campaign_topics(*), campaign_images(*)').eq('account_id', account.id).order('created_at', { ascending: false }),
  ])
  return { account, posts: posts ?? [], campaigns: campaigns ?? [] }
})

export const getPublishedPageData = createServerFn({ method: 'GET' })
  .validator((data: { limit: number }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      return { account: demoAccount, posts: demoPosts.filter((p) => p.state === 'published').map(withPillar).slice(0, data.limit) }
    }
    const { user, supabase } = await requireUser()
    const account = await firstAccount(user.id, supabase)
    if (!account) return { account: null, posts: [] }

    const { data: posts } = await supabase
      .from('posts')
      .select('*, content_pillars(name, kind), campaigns(name)')
      .eq('account_id', account.id)
      .eq('state', 'published')
      .order('published_at', { ascending: false })
      .limit(data.limit)
    return { account, posts: posts ?? [] }
  })
