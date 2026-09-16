import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { customImagePromptFor, fetchImageAsDataUrl, generateImage } from '../lib/image-ai'
import { getProvider } from '../lib/ai-providers'
import { resolveApiKey } from './settings'
import { resolveImageUrls } from './image-library'
import { DEMO_MODE } from '../lib/demo-mode'
import { demoPosts, logDemo } from '../lib/demo-data'

export const listRecentImagePrompts = createServerFn({ method: 'GET' })
  .validator((data: { accountId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) return []
    const { supabase } = await requireUser()
    const { data: rows, error } = await supabase
      .from('image_prompts')
      .select('prompt')
      .eq('account_id', data.accountId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw new Error(error.message)

    // De-dupe while preserving recency, capped at 5 for quick-select chips.
    const seen = new Set<string>()
    const recent: string[] = []
    for (const row of rows) {
      if (seen.has(row.prompt)) continue
      seen.add(row.prompt)
      recent.push(row.prompt)
      if (recent.length === 5) break
    }
    return recent
  })

// Replaces a post's supporting image with one generated from the user's own
// prompt (instead of the automatic pillar-based one), and records the
// prompt so it shows up in listRecentImagePrompts next time.
export const regenerateImage = createServerFn({ method: 'POST' })
  .validator((data: { accountId: string; postId: string; prompt: string }) => data)
  .handler(async ({ data }) => {
    const prompt = data.prompt.trim()
    if (!prompt) throw new Error('Enter a prompt first.')

    if (DEMO_MODE) {
      const post = demoPosts.find((p) => p.id === data.postId)
      if (!post) throw new Error('Post not found')
      Object.assign(post, { image_data_url: 'https://placehold.co/512x512?text=Demo+Image' })
      logDemo('generation', 'Image regenerated', `Custom prompt (demo mode - not a real AI call): "${prompt}"`, 'info', post.id)
      return { ok: true }
    }

    const { user, supabase } = await requireUser()

    const [{ data: post }, { data: account }] = await Promise.all([
      supabase.from('posts').select('*').eq('id', data.postId).single(),
      supabase.from('linkedin_accounts').select('*').eq('id', data.accountId).single(),
    ])
    if (!post || !account) throw new Error('Post or account not found.')

    const key = await resolveApiKey(user.id, supabase)
    if (!key) throw new Error('Add an AI provider key in Setup before generating images.')
    if (!getProvider(key.provider).supportsImages) throw new Error(`${getProvider(key.provider).label} doesn't support image generation - switch to Gemini in Setup.`)

    const { data: library } = await supabase.from('image_library').select('id, url, storage_path').eq('user_id', user.id).limit(10)
    const picked = (library ?? []).sort(() => Math.random() - 0.5).slice(0, 3)
    const signedUrls = await resolveImageUrls(supabase, picked)
    const referenceDataUrls = (
      await Promise.all(picked.map((p) => fetchImageAsDataUrl(signedUrls.get(p.id) ?? '')))
    ).filter((u): u is string => !!u)

    const imageDataUrl = await generateImage(
      key.apiKey,
      customImagePromptFor(
        prompt,
        post.body,
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
    if (!imageDataUrl) throw new Error('The model did not return an image - try a different prompt.')

    const { error } = await supabase.from('posts').update({ image_data_url: imageDataUrl }).eq('id', data.postId)
    if (error) throw new Error(error.message)
    await supabase.from('image_prompts').insert({ user_id: user.id, account_id: data.accountId, prompt })

    return { ok: true, imageDataUrl }
  })
