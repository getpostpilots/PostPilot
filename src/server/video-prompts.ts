import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { buildVideoSearchQuery, selectStockVideo } from '../lib/video-ai'
import { searchStockVideos } from '../lib/video-search'
import { resolveApiKey } from './settings'
import { DEMO_MODE } from '../lib/demo-mode'
import { demoPosts, logDemo } from '../lib/demo-data'

// Reroll button target: re-runs the search excluding the post's current pick
// (and any recently-used candidates for this pillar/campaign) so the swap
// reliably lands on something different, mirroring image-prompts.ts's
// regenerateImage.
export const regenerateVideo = createServerFn({ method: 'POST' })
  .validator((data: { accountId: string; postId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      const post = demoPosts.find((p) => p.id === data.postId)
      if (!post) throw new Error('Post not found')
      Object.assign(post, { video_url: 'https://cdn.pexels.com/video-placeholder-demo.mp4', video_thumbnail_url: 'https://placehold.co/640x360?text=Demo+Video' })
      logDemo('generation', 'Video rerolled', 'Demo mode - not a real search call.', 'info', post.id)
      return { ok: true }
    }

    const { user, supabase } = await requireUser()
    const [{ data: post }, { data: account }] = await Promise.all([
      supabase.from('posts').select('*').eq('id', data.postId).single(),
      supabase.from('linkedin_accounts').select('*').eq('id', data.accountId).single(),
    ])
    if (!post || !account) throw new Error('Post or account not found.')

    const key = await resolveApiKey(user.id, supabase)
    if (!key) throw new Error('Add an AI provider key in Setup before generating.')

    const excludeIds = post.video_provider_id ? [post.video_provider_id] : []
    const searchQuery = await buildVideoSearchQuery(
      key.provider,
      key.apiKey,
      key.model ?? undefined,
      key.base_url ?? undefined,
      post.topic ?? post.body.slice(0, 60),
      post.body,
      { description: account.video_style_description, include: account.video_style_include, avoid: account.video_style_avoid },
      post.video_search_query ? [post.video_search_query] : [],
    )
    const candidates = await searchStockVideos(searchQuery, { pexelsApiKey: process.env.PEXELS_API_KEY, pixabayApiKey: process.env.PIXABAY_API_KEY })
    const picked = selectStockVideo(candidates, excludeIds)
    if (!picked) throw new Error('No stock video found for that search - try again in a moment.')

    const { error } = await supabase
      .from('posts')
      .update({
        video_url: picked.videoUrl,
        video_thumbnail_url: picked.thumbnailUrl,
        video_search_query: searchQuery,
        video_provider: picked.provider,
        video_provider_id: picked.providerId,
      })
      .eq('id', data.postId)
    if (error) throw new Error(error.message)

    return { ok: true, videoUrl: picked.videoUrl }
  })
