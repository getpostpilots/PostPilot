import { supabaseAdmin } from '../lib/supabase-server'
import { generateDraft } from '../lib/ai'
import { generateImage, campaignImagePromptFor, fetchImageAsDataUrl } from '../lib/image-ai'
import { getProvider } from '../lib/ai-providers'
import { resolveApiKey } from './settings'
import { publishPost, uploadImage } from '../lib/linkedin'
import { getValidAccessToken } from './linkedin'
import { resolveImageUrls } from './image-library'
import { zonedTimeToUtcIso } from '../lib/timezones'

// Server-only: the actual campaign tick logic, run either by the in-process
// scheduler (see server/scheduler.ts) on a timer, or on-demand via "Post
// now" (server/campaigns.ts's postCampaignNow) for the next single topic.
// Caps and the min-gap guardrail always apply either way - "Post now" only
// skips the day/already-ran-today gate, never the safety limits.
// Uses the service-role client since a background timer has no logged-in
// user/request to scope an RLS client to.
type AdminClient = ReturnType<typeof supabaseAdmin>
type RunResult = { status: 'posted' | 'scheduled' | 'failed' | 'skipped'; reason?: string }

// Daily/weekly publish caps and cross-campaign spacing - the safety limits
// that apply no matter how a post reaches the publish step (automatic tick,
// "Post now", or a pre-generated campaign post whose scheduled_at has come
// due). Exported so posts.ts's scheduler can re-check it right before
// publishing a campaign-originated scheduled post, since generation and
// publish are no longer the same instant.
export async function checkPublishGuardrails(supabase: AdminClient, account: any): Promise<{ ok: true } | { ok: false; kind: 'cap' | 'spacing'; reason: string }> {
  // ponytail: rolling 24h/7d windows rather than exact local-midnight
  // boundaries - close enough for a pacing guardrail, upgrade if it matters.
  const [{ count: dailyCount }, { count: weeklyCount }] = await Promise.all([
    supabase.from('posts').select('id', { count: 'exact', head: true }).eq('account_id', account.id).eq('state', 'published').gte('published_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    supabase.from('posts').select('id', { count: 'exact', head: true }).eq('account_id', account.id).eq('state', 'published').gte('published_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
  ])
  if ((dailyCount ?? 0) >= account.daily_cap) return { ok: false, kind: 'cap', reason: 'Daily publish cap reached.' }
  if ((weeklyCount ?? 0) >= account.weekly_cap) return { ok: false, kind: 'cap', reason: 'Weekly publish cap reached.' }

  const { data: lastPublished } = await supabase
    .from('posts')
    .select('published_at')
    .eq('account_id', account.id)
    .eq('state', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastPublished?.published_at) {
    const minutesSince = (Date.now() - new Date(lastPublished.published_at).getTime()) / 60000
    if (minutesSince < account.min_gap_minutes) {
      const waitMin = Math.ceil(account.min_gap_minutes - minutesSince)
      return { ok: false, kind: 'spacing', reason: `Too soon after the last post - wait ${waitMin} more minute${waitMin === 1 ? '' : 's'}.` }
    }
  }
  return { ok: true }
}

function localParts(tz: string): { date: string; time: string; dayOfWeek: number } {
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now)
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  return { date, time, dayOfWeek }
}

async function logDecision(supabase: AdminClient, campaign: any, rationale: string, level: 'info' | 'warn' | 'error' = 'info') {
  await supabase.from('decision_logs').insert({
    user_id: campaign.user_id,
    account_id: campaign.account_id,
    stage: 'campaign',
    decision: `Campaign "${campaign.name}"`,
    rationale,
    level,
  })
}

async function runCampaign(supabase: AdminClient, campaign: any, opts: { skipScheduleGate?: boolean } = {}): Promise<RunResult> {
  const { data: account } = await supabase.from('linkedin_accounts').select('*').eq('id', campaign.account_id).single()
  if (!account) return { status: 'skipped', reason: 'Account not found.' }
  if (account.kill_switch_engaged) return { status: 'skipped', reason: 'Kill switch is engaged.' }

  const { date: today, dayOfWeek } = localParts(account.timezone || 'UTC')

  if (campaign.end_date && today > campaign.end_date) {
    await supabase.from('campaigns').update({ status: 'completed' }).eq('id', campaign.id)
    await logDecision(supabase, campaign, `Campaign finished - reached its end date (${campaign.end_date}).`)
    return { status: 'skipped', reason: 'Campaign has ended.' }
  }

  // Automatic ticks generate as soon as it's a scheduled day (not yet run
  // today) so the post can sit pre-made and wait for post_time to actually
  // publish - see the scheduling branch below. "Post now" (skipScheduleGate)
  // still needs today-not-yet-run to avoid double-posting the same slot.
  if (!opts.skipScheduleGate) {
    if (campaign.last_run_date === today) return { status: 'skipped', reason: 'Already ran today.' }
    if (!campaign.days_of_week.includes(dayOfWeek)) return { status: 'skipped', reason: 'Not a scheduled day.' }
  }

  const guardrail = await checkPublishGuardrails(supabase, account)
  if (!guardrail.ok) {
    await logDecision(supabase, campaign, `Skipped - ${guardrail.reason}`, guardrail.kind === 'cap' ? 'warn' : 'info')
    // Caps consume today's run; the spacing guardrail doesn't - the
    // scheduler retries next tick once the gap clears on its own, and a
    // manual "Post now" click just reports back that it's too soon.
    if (guardrail.kind === 'cap') {
      await supabase.from('campaigns').update({ last_run_date: today, last_run_at: new Date().toISOString() }).eq('id', campaign.id)
    }
    return { status: 'skipped', reason: guardrail.reason }
  }

  const { data: topics } = await supabase.from('campaign_topics').select('*').eq('campaign_id', campaign.id).order('order_index')
  if (!topics || topics.length === 0) {
    await logDecision(supabase, campaign, 'Skipped - no topics configured.', 'error')
    await supabase.from('campaigns').update({ last_run_date: today, last_run_at: new Date().toISOString() }).eq('id', campaign.id)
    return { status: 'skipped', reason: 'No topics configured.' }
  }
  const topic = topics[campaign.next_topic_index % topics.length]

  const key = await resolveApiKey(campaign.user_id, supabase as any)
  if (!key) {
    await logDecision(supabase, campaign, 'Skipped - no AI provider key configured in Setup.', 'error')
    await supabase.from('campaigns').update({ last_run_date: today, last_run_at: new Date().toISOString() }).eq('id', campaign.id)
    return { status: 'skipped', reason: 'No AI provider key configured in Setup.' }
  }

  // Dedup context: what this campaign has already posted/generated, so the
  // model doesn't repeat itself as topics cycle back around.
  const { data: priorPosts } = await supabase
    .from('posts')
    .select('body, image_prompt')
    .eq('campaign_id', campaign.id)
    .order('created_at', { ascending: false })
    .limit(15)
  const recentBodies = (priorPosts ?? []).map((p) => p.body)
  const recentImagePrompts = (priorPosts ?? []).map((p) => p.image_prompt).filter((p): p is string => !!p)

  const body = await generateDraft(key.provider, key.apiKey, key.model ?? undefined, key.base_url ?? undefined, {
    voiceProfileSample: null,
    pillarName: topic.topic,
    pillarDescription: `Campaign topic: ${topic.topic}`,
    pillarKind: 'product',
    founderBeliefs: [],
    primaryAudience: account.primary_audience,
    ctaMechanic: 'discussion',
    recentPosts: recentBodies,
    companyDescription: account.brand_description,
  })

  let imageDataUrl: string | null = null
  let imagePrompt: string | null = null
  if (getProvider(key.provider).supportsImages) {
    try {
      const { data: links } = await supabase
        .from('campaign_library_images')
        .select('image_library(id, url, storage_path)')
        .eq('campaign_id', campaign.id)
        .limit(10)
      const picked = (links ?? [])
        .map((l: any) => l.image_library)
        .filter(Boolean)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3) // was 2 - generateImage caps at 3, match it so refs are fully used
      const signedUrls = await resolveImageUrls(supabase, picked)
      const referenceDataUrls = (
        await Promise.all(picked.map((p: any) => fetchImageAsDataUrl(signedUrls.get(p.id) ?? '')))
      ).filter((u): u is string => !!u)

      imagePrompt = campaignImagePromptFor(
        topic.topic,
        body,
        { description: account.brand_description, primaryColor: account.brand_primary_color, secondaryColor: account.brand_secondary_color, tertiaryColor: account.brand_tertiary_color },
        recentImagePrompts,
        referenceDataUrls.length > 0,
      )
      imageDataUrl = await generateImage(key.apiKey, imagePrompt, referenceDataUrls)
    } catch (err) {
      console.error('Campaign image generation failed:', err)
    }
  }

  // "Post now" publishes this instant, same as always. An automatic tick
  // instead saves the generated post as `scheduled` for today's post_time -
  // the existing scheduled-posts runner (server/posts.ts) picks it up and
  // publishes it (re-checking these same guardrails) once that time comes.
  const immediate = !!opts.skipScheduleGate
  const scheduledAt = immediate ? null : zonedTimeToUtcIso(account.timezone || 'UTC', today, campaign.post_time)

  const { data: post, error: insertErr } = await supabase
    .from('posts')
    .insert({ user_id: campaign.user_id, account_id: account.id, campaign_id: campaign.id, pillar_id: null, topic: topic.topic, body, image_data_url: imageDataUrl, image_prompt: imagePrompt, state: immediate ? 'approved' : 'scheduled', scheduled_at: scheduledAt })
    .select()
    .single()
  if (insertErr || !post) {
    await logDecision(supabase, campaign, `Failed to save generated post: ${insertErr?.message}`, 'error')
    return { status: 'failed', reason: `Failed to save generated post: ${insertErr?.message}` }
  }

  let result: RunResult
  if (immediate) {
    try {
      const accessToken = await getValidAccessToken(account, supabase)
      const imageUrn = imageDataUrl ? await uploadImage(accessToken, account.member_sub, imageDataUrl) : null
      const urn = await publishPost(accessToken, account.member_sub, body, imageUrn)
      await supabase.from('posts').update({ state: 'published', published_at: new Date().toISOString(), linkedin_post_urn: urn, linkedin_image_urn: imageUrn }).eq('id', post.id)
      await logDecision(supabase, campaign, `Published to LinkedIn - topic "${topic.topic}".`)
      result = { status: 'posted' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await supabase.from('posts').update({ state: 'failed', failure_reason: message }).eq('id', post.id)
      await logDecision(supabase, campaign, `Generated but failed to publish - topic "${topic.topic}": ${message}`, 'error')
      result = { status: 'failed', reason: message }
    }
  } else {
    await logDecision(supabase, campaign, `Generated and scheduled for ${new Date(scheduledAt!).toLocaleString()} - topic "${topic.topic}".`)
    result = { status: 'scheduled' }
  }

  await supabase.from('campaigns').update({ last_run_date: today, last_run_at: new Date().toISOString(), next_topic_index: (campaign.next_topic_index + 1) % topics.length }).eq('id', campaign.id)
  return result
}

export async function runDueCampaigns() {
  const supabase = supabaseAdmin()
  const { data: campaigns } = await supabase.from('campaigns').select('*').eq('status', 'active')
  for (const campaign of campaigns ?? []) {
    try {
      await runCampaign(supabase, campaign)
    } catch (err) {
      console.error(`Campaign ${campaign.id} tick failed:`, err)
    }
  }
}

// Manually fires the campaign's next single topic right now, skipping only
// the day/already-ran gate - caps and the spacing guardrail still apply and
// can still block it (the returned reason explains why).
export async function postCampaignNow(campaignId: string): Promise<RunResult> {
  const supabase = supabaseAdmin()
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', campaignId).single()
  if (!campaign) return { status: 'skipped', reason: 'Campaign not found.' }
  return runCampaign(supabase, campaign, { skipScheduleGate: true })
}
