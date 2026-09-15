import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { postCampaignNow } from './campaign-engine'
import { DEMO_MODE } from '../lib/demo-mode'
import { demoAccount, logDemo, newDemoId } from '../lib/demo-data'

type NewCampaignInput = {
  accountId: string
  name: string
  durationType: 'week' | 'month' | 'evergreen'
  daysOfWeek: number[]
  postTime: string
  topics: string[]
  imageUrls: string[]
}

function endDateFor(durationType: NewCampaignInput['durationType'], startDate: Date): string | null {
  if (durationType === 'evergreen') return null
  const end = new Date(startDate)
  if (durationType === 'week') end.setDate(end.getDate() + 7)
  if (durationType === 'month') end.setMonth(end.getMonth() + 1)
  return end.toISOString().slice(0, 10)
}

// In-memory demo store - campaigns aren't part of demo-data.ts's shared
// fixtures since they're only meaningful with a real scheduler running.
const demoCampaigns: any[] = []

export const listCampaigns = createServerFn({ method: 'GET' })
  .validator((data: { accountId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) return demoCampaigns
    const { supabase } = await requireUser()
    const { data: rows, error } = await supabase
      .from('campaigns')
      .select('*, campaign_topics(*), campaign_images(*)')
      .eq('account_id', data.accountId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return rows
  })

// Combined read for the Campaigns page - used to be "fetch account, then
// fetch campaigns scoped to it" as two sequential network round-trips.
export const getCampaignsPageData = createServerFn({ method: 'GET' }).handler(async () => {
  if (DEMO_MODE) return { account: demoAccount, campaigns: demoCampaigns }
  const { user, supabase } = await requireUser()
  const { data: account } = await supabase.from('linkedin_accounts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!account) return { account: null, campaigns: [] }
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('*, campaign_topics(*), campaign_images(*)')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return { account, campaigns }
})

export const createCampaign = createServerFn({ method: 'POST' })
  .validator((data: NewCampaignInput) => data)
  .handler(async ({ data }) => {
    const topics = data.topics.map((t) => t.trim()).filter(Boolean)
    const imageUrls = data.imageUrls.map((u) => u.trim()).filter(Boolean)
    if (topics.length === 0) throw new Error('Add at least one topic.')
    if (data.daysOfWeek.length === 0) throw new Error('Pick at least one day.')

    const startDate = new Date()
    const endDate = endDateFor(data.durationType, startDate)

    if (DEMO_MODE) {
      const campaign = {
        id: newDemoId(),
        account_id: demoAccount.id,
        name: data.name,
        status: 'active',
        duration_type: data.durationType,
        start_date: startDate.toISOString().slice(0, 10),
        end_date: endDate,
        days_of_week: data.daysOfWeek,
        post_time: data.postTime,
        last_run_date: null,
        last_run_at: null,
        next_topic_index: 0,
        campaign_topics: topics.map((topic, i) => ({ id: newDemoId(), topic, order_index: i })),
        campaign_images: imageUrls.map((url) => ({ id: newDemoId(), url })),
      }
      demoCampaigns.unshift(campaign)
      logDemo('campaign', 'Campaign created', `"${data.name}" - ${topics.length} topic(s), demo mode (not scheduled for real).`)
      return campaign
    }

    const { user, supabase } = await requireUser()
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        account_id: data.accountId,
        name: data.name,
        duration_type: data.durationType,
        start_date: startDate.toISOString().slice(0, 10),
        end_date: endDate,
        days_of_week: data.daysOfWeek,
        post_time: data.postTime,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)

    if (topics.length) {
      const { error: topicsErr } = await supabase
        .from('campaign_topics')
        .insert(topics.map((topic, i) => ({ user_id: user.id, campaign_id: campaign.id, topic, order_index: i })))
      if (topicsErr) throw new Error(topicsErr.message)
    }
    if (imageUrls.length) {
      const { error: imagesErr } = await supabase
        .from('campaign_images')
        .insert(imageUrls.map((url) => ({ user_id: user.id, campaign_id: campaign.id, url })))
      if (imagesErr) throw new Error(imagesErr.message)
    }

    await supabase.from('decision_logs').insert({
      user_id: user.id,
      account_id: data.accountId,
      stage: 'campaign',
      decision: 'Campaign created',
      rationale: `"${data.name}" - ${topics.length} topic(s), ${data.durationType}, days ${data.daysOfWeek.join(',')} at ${data.postTime}.`,
    })

    return campaign
  })

type EditCampaignInput = {
  campaignId: string
  name: string
  durationType: 'week' | 'month' | 'evergreen'
  daysOfWeek: number[]
  postTime: string
  topics: string[]
  imageUrls: string[]
}

export const updateCampaign = createServerFn({ method: 'POST' })
  .validator((data: EditCampaignInput) => data)
  .handler(async ({ data }) => {
    const topics = data.topics.map((t) => t.trim()).filter(Boolean)
    const imageUrls = data.imageUrls.map((u) => u.trim()).filter(Boolean)
    if (topics.length === 0) throw new Error('Add at least one topic.')
    if (data.daysOfWeek.length === 0) throw new Error('Pick at least one day.')

    if (DEMO_MODE) {
      const c = demoCampaigns.find((row) => row.id === data.campaignId)
      if (c) {
        // Editing a finished campaign restarts its clock from today, rather
        // than recomputing an end_date from its old (already-past) start.
        const restarting = c.status === 'completed'
        const startDate = restarting ? new Date() : new Date(c.start_date)
        const endDate = endDateFor(data.durationType, startDate)
        Object.assign(c, {
          name: data.name,
          duration_type: data.durationType,
          start_date: startDate.toISOString().slice(0, 10),
          end_date: endDate,
          days_of_week: data.daysOfWeek,
          post_time: data.postTime,
          next_topic_index: 0,
          ...(restarting ? { status: 'active', last_run_date: null, last_run_at: null } : {}),
        })
        c.campaign_topics = topics.map((topic, i) => ({ id: newDemoId(), topic, order_index: i }))
        c.campaign_images = imageUrls.map((url) => ({ id: newDemoId(), url }))
        logDemo('campaign', 'Campaign edited', `"${data.name}" updated (demo mode).`)
      }
      return { ok: true }
    }

    const { user, supabase } = await requireUser()
    const { data: existing, error: fetchErr } = await supabase.from('campaigns').select('start_date, account_id, status').eq('id', data.campaignId).single()
    if (fetchErr) throw new Error(fetchErr.message)
    const restarting = existing.status === 'completed'
    const startDate = restarting ? new Date() : new Date(existing.start_date)
    const endDate = endDateFor(data.durationType, startDate)

    const { error } = await supabase
      .from('campaigns')
      .update({
        name: data.name,
        duration_type: data.durationType,
        start_date: startDate.toISOString().slice(0, 10),
        end_date: endDate,
        days_of_week: data.daysOfWeek,
        post_time: data.postTime,
        next_topic_index: 0,
        ...(restarting ? { status: 'active', last_run_date: null, last_run_at: null } : {}),
      })
      .eq('id', data.campaignId)
    if (error) throw new Error(error.message)

    // Full replace, same pattern as savePillars/saveFounderPov - simpler
    // than diffing, and topic order/content changing invalidates the old
    // round-robin position anyway (hence resetting next_topic_index above).
    await supabase.from('campaign_topics').delete().eq('campaign_id', data.campaignId)
    await supabase.from('campaign_images').delete().eq('campaign_id', data.campaignId)
    if (topics.length) {
      const { error: topicsErr } = await supabase
        .from('campaign_topics')
        .insert(topics.map((topic, i) => ({ user_id: user.id, campaign_id: data.campaignId, topic, order_index: i })))
      if (topicsErr) throw new Error(topicsErr.message)
    }
    if (imageUrls.length) {
      const { error: imagesErr } = await supabase
        .from('campaign_images')
        .insert(imageUrls.map((url) => ({ user_id: user.id, campaign_id: data.campaignId, url })))
      if (imagesErr) throw new Error(imagesErr.message)
    }

    await supabase.from('decision_logs').insert({
      user_id: user.id,
      account_id: existing.account_id,
      stage: 'campaign',
      decision: 'Campaign edited',
      rationale: `"${data.name}" - ${topics.length} topic(s), ${data.durationType}, days ${data.daysOfWeek.join(',')} at ${data.postTime}.`,
    })

    return { ok: true }
  })

export const setCampaignStatus = createServerFn({ method: 'POST' })
  .validator((data: { campaignId: string; status: 'active' | 'paused' | 'completed' }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const c = demoCampaigns.find((row) => row.id === data.campaignId)
      if (c) c.status = data.status
      return { ok: true }
    }
    const { supabase } = await requireUser()
    const { error } = await supabase.from('campaigns').update({ status: data.status }).eq('id', data.campaignId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const deleteCampaign = createServerFn({ method: 'POST' })
  .validator((data: { campaignId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const idx = demoCampaigns.findIndex((c) => c.id === data.campaignId)
      if (idx !== -1) demoCampaigns.splice(idx, 1)
      return { ok: true }
    }
    const { supabase } = await requireUser()
    const { error } = await supabase.from('campaigns').delete().eq('id', data.campaignId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// Fires just the campaign's next topic right now, instead of waiting for
// its scheduled time - daily/weekly caps and the min-gap guardrail still
// apply (the result explains why if it's blocked), so this can't be used
// to dump every topic out at once or ignore the pacing rules.
export const postCampaignNowFn = createServerFn({ method: 'POST' })
  .validator((data: { campaignId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const c = demoCampaigns.find((row) => row.id === data.campaignId)
      if (c) {
        logDemo('campaign', 'Posted now', `"${c.name}" - next topic posted (demo mode - not a real AI/LinkedIn call).`)
        c.last_run_date = new Date().toISOString().slice(0, 10)
        c.last_run_at = new Date().toISOString()
        const topicCount = c.campaign_topics?.length ?? 0
        if (topicCount) c.next_topic_index = (c.next_topic_index + 1) % topicCount
      }
      return { status: 'posted' as const }
    }
    return postCampaignNow(data.campaignId)
  })
