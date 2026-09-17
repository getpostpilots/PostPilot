import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { requireUser, supabaseAdmin } from '../lib/supabase-server'
import { publishPost, uploadImage } from '../lib/linkedin'
import { getValidAccessToken } from './linkedin'
import { checkPublishGuardrails } from './campaign-engine'
import { DEMO_MODE } from '../lib/demo-mode'
import {
  demoAccount,
  demoNow,
  demoPosts,
  logDemo,
  newDemoId,
} from '../lib/demo-data'
import type { DemoPost } from '../lib/demo-data'

async function logDecision(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  accountId: string,
  postId: string | null,
  stage: string,
  decision: string,
  rationale: string,
  level: 'info' | 'warn' | 'error' = 'info',
) {
  await supabase.from('decision_logs').insert({
    user_id: userId,
    account_id: accountId,
    post_id: postId,
    stage,
    decision,
    rationale,
    level,
  })
}

export const createPost = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      accountId: string
      pillarId: string | null
      body: string
      scheduledAt: string | null
    }) => data,
  )
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const row: DemoPost = {
        id: newDemoId(),
        account_id: data.accountId,
        pillar_id: data.pillarId,
        body: data.body,
        state: data.scheduledAt ? 'scheduled' : 'draft',
        scheduled_at: data.scheduledAt,
        published_at: null,
        linkedin_post_urn: null,
        kill_reason: null,
        failure_reason: null,
        created_at: demoNow(),
        updated_at: demoNow(),
      }
      demoPosts.unshift(row)
      logDemo(
        'compose',
        'Draft added',
        'Written directly in the queue, not generated.',
        'info',
        row.id,
      )
      return row
    }

    const { user, supabase } = await requireUser()
    const { data: row, error } = await supabase
      .from('posts')
      .insert({
        user_id: user.id,
        account_id: data.accountId,
        pillar_id: data.pillarId,
        body: data.body,
        state: data.scheduledAt ? 'scheduled' : 'draft',
        scheduled_at: data.scheduledAt,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    await logDecision(
      supabase,
      user.id,
      data.accountId,
      row.id,
      'compose',
      'Draft added',
      'Written directly in the queue, not generated.',
    )
    return row
  })

export const updatePostBody = createServerFn({ method: 'POST' })
  .validator((data: { postId: string; body: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const post = demoPosts.find((p) => p.id === data.postId)
      if (post) {
        post.body = data.body
        post.updated_at = demoNow()
      }
      return { ok: true }
    }
    const { supabase } = await requireUser()
    const { error } = await supabase
      .from('posts')
      .update({ body: data.body })
      .eq('id', data.postId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const deletePost = createServerFn({ method: 'POST' })
  .validator((data: { postId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const idx = demoPosts.findIndex((p) => p.id === data.postId)
      if (idx !== -1) demoPosts.splice(idx, 1)
      return { ok: true }
    }
    const { supabase } = await requireUser()
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', data.postId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const setPostState = createServerFn({ method: 'POST' })
  .validator(
    (data: { postId: string; state: string; scheduledAt?: string | null }) =>
      data,
  )
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const post = demoPosts.find((p) => p.id === data.postId)
      if (!post) throw new Error('Post not found')
      post.state = data.state as typeof post.state
      post.scheduled_at = data.scheduledAt ?? null
      post.updated_at = demoNow()
      logDemo(
        'release',
        `Post ${data.state}`,
        data.state === 'scheduled' && data.scheduledAt
          ? `Scheduled for ${new Date(data.scheduledAt).toLocaleString()}.`
          : `Moved to ${data.state} by user.`,
        'info',
        post.id,
      )
      return { ok: true }
    }

    const { user, supabase } = await requireUser()
    const { data: post, error: fetchErr } = await supabase
      .from('posts')
      .select('*')
      .eq('id', data.postId)
      .single()
    if (fetchErr) throw new Error(fetchErr.message)

    const { error } = await supabase
      .from('posts')
      .update({ state: data.state, scheduled_at: data.scheduledAt ?? null })
      .eq('id', data.postId)
    if (error) throw new Error(error.message)

    await logDecision(
      supabase,
      user.id,
      post.account_id,
      data.postId,
      'release',
      `Post ${data.state}`,
      data.state === 'scheduled' && data.scheduledAt
        ? `Scheduled for ${new Date(data.scheduledAt).toLocaleString()}.`
        : `Moved to ${data.state} by user.`,
    )
    return { ok: true }
  })

export const approveAllDrafts = createServerFn({ method: 'POST' })
  .validator((data: { accountId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const drafts = demoPosts.filter((p) => p.state === 'draft')
      for (const p of drafts) {
        p.state = 'approved'
        p.updated_at = demoNow()
      }
      logDemo(
        'release',
        'Bulk approve',
        `${drafts.length} draft(s) approved at once.`,
      )
      return { count: drafts.length }
    }

    const { user, supabase } = await requireUser()
    const { data: rows, error } = await supabase
      .from('posts')
      .update({ state: 'approved' })
      .eq('account_id', data.accountId)
      .eq('state', 'draft')
      .select('id')
    if (error) throw new Error(error.message)
    await logDecision(
      supabase,
      user.id,
      data.accountId,
      null,
      'release',
      'Bulk approve',
      `${rows.length} draft(s) approved at once.`,
    )
    return { count: rows.length }
  })

// Publishes immediately, respecting the kill switch and pacing limits. This
// is also what the (not-yet-built) scheduler cron calls for due `scheduled`
// posts - see ARCHITECTURE.md "Scheduler" section.
export const publishNow = createServerFn({ method: 'POST' })
  .validator((data: { postId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const post = demoPosts.find((p) => p.id === data.postId)
      if (!post) throw new Error('Post not found')
      if (demoAccount.kill_switch_engaged) {
        logDemo(
          'safety',
          'Publish blocked',
          'Kill switch is engaged.',
          'error',
          post.id,
        )
        throw new Error('Publishing is paused for this account.')
      }
      post.state = 'published'
      post.published_at = demoNow()
      post.linkedin_post_urn = `urn:li:share:${newDemoId()}`
      post.updated_at = demoNow()
      logDemo(
        'release',
        'Published',
        'Simulated publish - demo mode never calls LinkedIn.',
        'info',
        post.id,
      )
      return { ok: true, urn: post.linkedin_post_urn }
    }

    const { user, supabase } = await requireUser()

    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('*')
      .eq('id', data.postId)
      .single()
    if (postErr) throw new Error(postErr.message)

    const { data: account, error: accErr } = await supabase
      .from('linkedin_accounts')
      .select('*')
      .eq('id', post.account_id)
      .single()
    if (accErr) throw new Error(accErr.message)

    if (account.kill_switch_engaged) {
      await logDecision(
        supabase,
        user.id,
        account.id,
        post.id,
        'safety',
        'Publish blocked',
        'Kill switch is engaged.',
        'error',
      )
      throw new Error('Publishing is paused for this account.')
    }

    try {
      const accessToken = await getValidAccessToken(account, supabase)
      const imageUrn = post.image_data_url
        ? await uploadImage(accessToken, account.member_sub, post.image_data_url)
        : null
      const urn = await publishPost(accessToken, account.member_sub, post.body, imageUrn)
      await supabase
        .from('posts')
        .update({
          state: 'published',
          published_at: new Date().toISOString(),
          linkedin_post_urn: urn,
          linkedin_image_urn: imageUrn,
        })
        .eq('id', post.id)
      await logDecision(
        supabase,
        user.id,
        account.id,
        post.id,
        'release',
        'Published',
        'Posted to LinkedIn via the Posts API.',
      )
      return { ok: true, urn }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await supabase
        .from('posts')
        .update({ state: 'failed', failure_reason: message })
        .eq('id', post.id)
      await logDecision(
        supabase,
        user.id,
        account.id,
        post.id,
        'release',
        'Publish failed',
        message,
        'error',
      )
      throw err
    }
  })

// Called by the in-process scheduler tick (see server/scheduler.ts) to flip
// due `scheduled` posts to `published` - the cron publishNow's comment used
// to call "not-yet-built" (ARCHITECTURE.md "Known gaps" #1). Same publish
// path as publishNow, but on the service-role client since a background
// timer has no logged-in user to scope an RLS client to.
//
// Wrapped in createServerOnlyFn, not a plain exported function - this
// module is imported from routes/app/scheduled.tsx (client code), and a
// plain export here drags supabase-server.ts's cookie/Node APIs into the
// client bundle and breaks the build. Same fix as server/scheduler.ts.
export const runDueScheduledPosts = createServerOnlyFn(async () => {
  const supabase = supabaseAdmin()
  const { data: posts } = await supabase
    .from('posts')
    .select('*')
    .eq('state', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())

  for (const post of posts ?? []) {
    const { data: account, error: accErr } = await supabase
      .from('linkedin_accounts')
      .select('*')
      .eq('id', post.account_id)
      .single()
    if (accErr || !account) {
      console.error(`Scheduled post ${post.id}: account not found`)
      continue
    }
    if (account.kill_switch_engaged) {
      await logDecision(supabase, post.user_id, account.id, post.id, 'safety', 'Publish blocked', 'Kill switch is engaged.', 'error')
      continue
    }

    // Campaign-generated posts are pre-made ahead of their post_time, so the
    // caps/spacing checked at generation time may be stale by the time this
    // fires - re-check right before publishing. Manually scheduled posts
    // were never capped (the user explicitly chose to post them).
    if (post.campaign_id) {
      const guardrail = await checkPublishGuardrails(supabase, account)
      if (!guardrail.ok) continue // leave it scheduled, retry next tick
    }

    try {
      const accessToken = await getValidAccessToken(account, supabase)
      const imageUrn = post.image_data_url ? await uploadImage(accessToken, account.member_sub, post.image_data_url) : null
      const urn = await publishPost(accessToken, account.member_sub, post.body, imageUrn)
      await supabase
        .from('posts')
        .update({ state: 'published', published_at: new Date().toISOString(), linkedin_post_urn: urn, linkedin_image_urn: imageUrn })
        .eq('id', post.id)
      await logDecision(supabase, post.user_id, account.id, post.id, 'release', 'Published', 'Posted to LinkedIn via the scheduler.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await supabase.from('posts').update({ state: 'failed', failure_reason: message }).eq('id', post.id)
      await logDecision(supabase, post.user_id, account.id, post.id, 'release', 'Publish failed', message, 'error')
      console.error(`Scheduled post ${post.id} publish failed:`, err)
    }
  }
})
