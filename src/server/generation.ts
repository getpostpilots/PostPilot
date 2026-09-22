import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { generateDraft } from '../lib/ai'
import { fetchImageAsDataUrl, generateImage, imagePromptFor } from '../lib/image-ai'
import { buildVideoSearchQuery, selectStockVideo } from '../lib/video-ai'
import { searchStockVideos } from '../lib/video-search'
import { getProvider } from '../lib/ai-providers'
import { resolveApiKey } from './settings'
import { resolveImageUrls } from './image-library'
import { nextMediaType } from './media-type'
import { DEMO_MODE } from '../lib/demo-mode'
import {
  demoNow,
  demoPillars,
  demoPosts,
  findDemoPillar,
  logDemo,
  newDemoId,
} from '../lib/demo-data'
import type { DemoPost } from '../lib/demo-data'

function demoDraftBody(pillarName: string, kind: 'founder' | 'product') {
  return kind === 'founder'
    ? `Every time I've been tempted to solve "${pillarName}" with more headcount, the real fix turned out to be a process I was avoiding.\n\nWhat's the version of that you've run into?`
    : `Most teams treat "${pillarName}" as a tooling problem. It's usually a targeting problem wearing a tooling costume.\n\nWhat changed it for you?`
}

// ponytail: runs generation inline inside the request instead of a queue +
// background worker. Fine while drafts take a few seconds; move to a cron/
// queue worker (e.g. Supabase Edge Function on a schedule) if generation
// latency or concurrent load becomes a problem.
export const generateForPillar = createServerFn({ method: 'POST' })
  .validator(
    (data: { accountId: string; pillarId: string; count?: number }) => data,
  )
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const pillar = findDemoPillar(data.pillarId)
      if (!pillar) throw new Error('Pillar not found.')
      const row: DemoPost = {
        id: newDemoId(),
        account_id: pillar.account_id,
        pillar_id: pillar.id,
        body: demoDraftBody(pillar.name, pillar.kind),
        state: 'draft',
        scheduled_at: null,
        published_at: null,
        linkedin_post_urn: null,
        kill_reason: null,
        failure_reason: null,
        created_at: demoNow(),
        updated_at: demoNow(),
      }
      demoPosts.unshift(row)
      logDemo(
        'generation',
        'Draft written',
        `Generated for pillar "${pillar.name}" (demo mode - not a real AI call).`,
        'info',
        row.id,
      )
      return { jobId: newDemoId(), queued: true, generated: 1 }
    }

    const { user, supabase } = await requireUser()

    const key = await resolveApiKey(user.id, supabase)
    if (!key)
      throw new Error('Add an AI provider key in Setup before generating.')

    const [
      { data: pillar },
      { data: account },
      { data: voice },
      { data: beliefs },
      { data: recent },
    ] = await Promise.all([
      supabase
        .from('content_pillars')
        .select('*')
        .eq('id', data.pillarId)
        .single(),
      supabase
        .from('linkedin_accounts')
        .select('*')
        .eq('id', data.accountId)
        .single(),
      supabase
        .from('voice_profiles')
        .select('*')
        .eq('account_id', data.accountId)
        .eq('active', true)
        .maybeSingle(),
      supabase
        .from('founder_pov')
        .select('*')
        .eq('account_id', data.accountId)
        .eq('active', true),
      supabase
        .from('posts')
        .select('body')
        .eq('account_id', data.accountId)
        .eq('state', 'published')
        .order('published_at', { ascending: false })
        .limit(10),
    ])
    if (!pillar || !account) throw new Error('Account or pillar not found.')

    const { data: priorPillarPosts } = await supabase
      .from('posts')
      .select('video_search_query, video_provider_id')
      .eq('pillar_id', data.pillarId)
      .order('created_at', { ascending: false })
      .limit(15)
    const recentVideoQueries = (priorPillarPosts ?? []).map((p) => p.video_search_query).filter((p): p is string => !!p)
    const recentVideoProviderIds = (priorPillarPosts ?? []).map((p) => p.video_provider_id).filter((p): p is string => !!p)

    const { data: job } = await supabase
      .from('generation_jobs')
      .insert({
        user_id: user.id,
        account_id: data.accountId,
        pillar_id: data.pillarId,
        status: 'running',
        requested_count: data.count ?? 1,
      })
      .select()
      .single()

    try {
      const body = await generateDraft(
        key.provider,
        key.apiKey,
        key.model ?? undefined,
        key.base_url ?? undefined,
        {
          voiceProfileSample:
            voice?.source_posts?.slice(0, 5).join('\n\n---\n\n') ?? null,
          pillarName: pillar.name,
          pillarDescription: pillar.description,
          pillarKind: pillar.kind,
          founderBeliefs: beliefs ?? [],
          primaryAudience: account.primary_audience,
          ctaMechanic: pillar.cta_mechanic,
          recentPosts: (recent ?? []).map((p) => p.body),
          companyDescription: account.brand_description,
        },
      )

      const mediaType = nextMediaType(pillar)

      // Best-effort: a failed image/video shouldn't sink an otherwise-good draft.
      let imageDataUrl: string | null = null
      if (mediaType === 'image' && getProvider(key.provider).supportsImages) {
        try {
          // ponytail: simple 1-in-4 heuristic so product posts occasionally
          // carry the real brand logo instead of an AI-generated scene -
          // upgrade to something smarter (e.g. per-pillar setting) if it
          // shows up too often/rarely in practice.
          const useLogo = pillar.kind === 'product' && account.logo_url && Math.random() < 0.25
          if (useLogo) {
            imageDataUrl = await fetchImageAsDataUrl(account.logo_url)
          } else {
            const { data: library } = await supabase.from('image_library').select('id, url, storage_path').eq('user_id', user.id).limit(10)
            const picked = (library ?? []).sort(() => Math.random() - 0.5).slice(0, 3)
            const signedUrls = await resolveImageUrls(supabase, picked)
            const referenceDataUrls = (
              await Promise.all(picked.map((p) => fetchImageAsDataUrl(signedUrls.get(p.id) ?? '')))
            ).filter((u): u is string => !!u)
            imageDataUrl = await generateImage(
              key.apiKey,
              imagePromptFor(
                pillar.name,
                body,
                {
                  description: account.brand_description,
                  primaryColor: account.brand_primary_color,
                  secondaryColor: account.brand_secondary_color,
                  tertiaryColor: account.brand_tertiary_color,
                },
                referenceDataUrls.length > 0,
              ),
              referenceDataUrls,
            )
          }
        } catch (err) {
          console.error('Image generation failed:', err)
        }
      }

      let video: { url: string; thumbnailUrl: string; searchQuery: string; provider: string; providerId: string } | null = null
      if (mediaType === 'video' && (process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY)) {
        try {
          const searchQuery = await buildVideoSearchQuery(
            key.provider,
            key.apiKey,
            key.model ?? undefined,
            key.base_url ?? undefined,
            pillar.name,
            body,
            { description: account.video_style_description, include: account.video_style_include, avoid: account.video_style_avoid },
            recentVideoQueries,
          )
          const candidates = await searchStockVideos(searchQuery, { pexelsApiKey: process.env.PEXELS_API_KEY, pixabayApiKey: process.env.PIXABAY_API_KEY })
          const picked = selectStockVideo(candidates, recentVideoProviderIds)
          if (picked) video = { url: picked.videoUrl, thumbnailUrl: picked.thumbnailUrl, searchQuery, provider: picked.provider, providerId: picked.providerId }
        } catch (err) {
          console.error('Video search failed:', err)
        }
      }

      const { data: post } = await supabase
        .from('posts')
        .insert({
          user_id: user.id,
          account_id: data.accountId,
          pillar_id: data.pillarId,
          topic: pillar.name,
          body,
          image_data_url: imageDataUrl,
          video_url: video?.url ?? null,
          video_thumbnail_url: video?.thumbnailUrl ?? null,
          video_search_query: video?.searchQuery ?? null,
          video_provider: video?.provider ?? null,
          video_provider_id: video?.providerId ?? null,
          state: 'draft',
        })
        .select()
        .single()

      await supabase.from('content_pillars').update({ last_media_type: mediaType }).eq('id', data.pillarId)

      await supabase
        .from('generation_jobs')
        .update({
          status: 'done',
          generated_count: 1,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job!.id)
      await supabase.from('decision_logs').insert({
        user_id: user.id,
        account_id: data.accountId,
        post_id: post?.id,
        stage: 'generation',
        decision: 'Draft written',
        rationale: `Generated for pillar "${pillar.name}" from voice profile and founder POV.`,
      })

      return { jobId: job!.id, queued: true, generated: 1 }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed'
      await supabase
        .from('generation_jobs')
        .update({
          status: 'failed',
          error: message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job!.id)
      await supabase.from('decision_logs').insert({
        user_id: user.id,
        account_id: data.accountId,
        stage: 'generation',
        decision: 'Generation failed',
        rationale: message,
        level: 'error',
      })
      return { jobId: job!.id, queued: true, reason: message }
    }
  })

// Tops up the queue by generating one post for whichever active pillar is
// furthest behind its target_share among already-published posts.
export const topUpQueue = createServerFn({ method: 'POST' })
  .validator((data: { accountId: string }) => data)
  .handler(async ({ data }) => {
    const pillars = DEMO_MODE ? demoPillars.filter((p) => p.active) : null
    if (DEMO_MODE) {
      if (!pillars || pillars.length === 0)
        return { queued: false, reason: 'No active pillars. Add one in Setup.' }
      const published = demoPosts.filter((p) => p.state === 'published')
      const counts = new Map<string, number>()
      for (const p of published)
        if (p.pillar_id)
          counts.set(p.pillar_id, (counts.get(p.pillar_id) ?? 0) + 1)
      const total = published.length
      let behind = pillars[0]
      let worstGap = -Infinity
      for (const p of pillars) {
        const actual = total > 0 ? (counts.get(p.id) ?? 0) / total : 0
        const gap = Number(p.target_share) - actual
        if (gap > worstGap) {
          worstGap = gap
          behind = p
        }
      }
      return { queued: true, pillarId: behind.id, reason: null }
    }

    const { supabase } = await requireUser()
    const { data: realPillars } = await supabase
      .from('content_pillars')
      .select('*')
      .eq('account_id', data.accountId)
      .eq('active', true)
    if (!realPillars || realPillars.length === 0)
      return { queued: false, reason: 'No active pillars. Add one in Setup.' }

    const { data: published } = await supabase
      .from('posts')
      .select('pillar_id')
      .eq('account_id', data.accountId)
      .eq('state', 'published')
    const counts = new Map<string, number>()
    for (const p of published ?? [])
      if (p.pillar_id)
        counts.set(p.pillar_id, (counts.get(p.pillar_id) ?? 0) + 1)
    const total = published?.length ?? 0

    let behind = realPillars[0]
    let worstGap = -Infinity
    for (const p of realPillars) {
      const actual = total > 0 ? (counts.get(p.id) ?? 0) / total : 0
      const gap = Number(p.target_share) - actual
      if (gap > worstGap) {
        worstGap = gap
        behind = p
      }
    }

    return { queued: true, pillarId: behind.id, reason: null }
  })
