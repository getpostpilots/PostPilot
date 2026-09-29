import { completeText } from './ai'
import { searchStockVideos, type StockVideoCandidate } from './video-search'

export type VideoStyle = { description?: string | null; include?: string | null; avoid?: string | null }

function queryPrompt(topic: string, postBody: string, style: VideoStyle | undefined, recentQueries: string[]): string {
  return [
    'Write a stock-video search query for a LinkedIn post: 3-6 words, no punctuation, no quotes, output only the query text and nothing else.',
    'Describe a concrete, literal, visually striking scene that a camera can film (people in action, real environments, dynamic movement) that works as a metaphor for the post. Never abstract concepts, never generic office or handshake footage.',
    `Post topic: ${topic}`,
    `Post content for context: ${postBody.slice(0, 600)}`,
    style?.description ? `Desired style/mood: ${style.description}` : '',
    style?.include ? `Favor subjects like: ${style.include}` : '',
    style?.avoid ? `Avoid subjects like: ${style.avoid}` : '',
    recentQueries.length ? `Already searched recently - pick a different angle, not a variation of these:\n${recentQueries.map((q) => `- ${q}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// One small text-gen call turning the post + the account's video style
// profile into a stock-search phrase, so the AI is following a guided prompt
// about what to look for instead of guessing. `recentQueries` avoids
// re-pulling the same clip across a campaign, mirroring campaignImagePromptFor.
export async function buildVideoSearchQuery(
  providerId: string,
  apiKey: string,
  model: string | undefined,
  baseUrlOverride: string | undefined,
  topic: string,
  postBody: string,
  style: VideoStyle | undefined,
  recentQueries: string[] = [],
): Promise<string> {
  // 30 tokens was too tight - a stray reasoning token or two left no room
  // for the actual query, and the fallback below then searched stock video
  // APIs on the *entire* topic sentence instead of a short phrase.
  const text = await completeText(providerId, apiKey, model, baseUrlOverride, queryPrompt(topic, postBody, style, recentQueries), 80)
  const cleaned = text.replace(/["'.]/g, '').trim()
  return cleaned || topic.split(/\s+/).slice(0, 6).join(' ')
}

// The whole "matching" logic: take the first pooled candidate not already
// used recently. Both search APIs already rank by relevance, so no separate
// scoring model is needed on top.
export function selectStockVideo(candidates: StockVideoCandidate[], recentProviderIds: string[]): StockVideoCandidate | null {
  if (candidates.length === 0) return null
  return candidates.find((c) => !recentProviderIds.includes(c.providerId)) ?? candidates[0]
}

// Asks the model to choose the clip that best fits the post from the pooled
// candidates' descriptions; any bad answer falls back to selectStockVideo.
async function pickBestFit(
  key: ApiKey,
  topic: string,
  postBody: string,
  candidates: StockVideoCandidate[],
  recentProviderIds: string[],
): Promise<StockVideoCandidate | null> {
  const fresh = candidates.filter((c) => !recentProviderIds.includes(c.providerId)).slice(0, 12)
  if (fresh.length < 2) return selectStockVideo(candidates, recentProviderIds)
  const list = fresh.map((c, i) => `${i + 1}. ${c.description || 'no description'}`).join('\n')
  try {
    const text = await completeText(
      key.provider,
      key.apiKey,
      key.model,
      key.baseUrl,
      `Pick the stock video that best fits this LinkedIn post and would stop a scroll. Reply with only the number.
Post topic: ${topic}
Post: ${postBody.slice(0, 600)}
Clips:
${list}`,
      80,
    )
    const n = parseInt(text.match(/\d+/)?.[0] ?? '', 10)
    if (n >= 1 && n <= fresh.length) return fresh[n - 1]
  } catch {}
  return selectStockVideo(candidates, recentProviderIds)
}

type ApiKey = { provider: string; apiKey: string; model?: string; baseUrl?: string }

// The single entry point all three call sites (generation, campaign engine,
// reroll) use: build query, search, AI-pick. Media is mandatory, so it walks a
// ladder of progressively simpler queries (each strict, then relaxed on clip
// length) and only throws when every rung came back empty.
export async function findStockVideo(
  key: ApiKey,
  topic: string,
  postBody: string,
  style: VideoStyle | undefined,
  recentQueries: string[],
  recentProviderIds: string[],
): Promise<{ searchQuery: string; picked: StockVideoCandidate }> {
  if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) throw new Error('No PEXELS_API_KEY or PIXABAY_API_KEY is set on the server.')
  const keys = { pexelsApiKey: process.env.PEXELS_API_KEY, pixabayApiKey: process.env.PIXABAY_API_KEY }

  let aiQuery = ''
  try {
    aiQuery = await buildVideoSearchQuery(key.provider, key.apiKey, key.model, key.baseUrl, topic, postBody, style, recentQueries)
  } catch (err) {
    console.error('Video query generation failed, using fallbacks:', err)
  }
  const words = (t: string, n: number) => t.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, n).join(' ')
  const ladder = [aiQuery, words(aiQuery, 3), words(topic, 4), words(style?.include ?? '', 3), 'business team working', 'city skyline', 'people talking']
  const queries = [...new Set(ladder.filter(Boolean))]

  let lastError: unknown
  for (const searchQuery of queries) {
    for (const relaxed of [false, true]) {
      try {
        const candidates = await searchStockVideos(searchQuery, keys, 15, relaxed)
        const picked = await pickBestFit(key, topic, postBody, candidates, recentProviderIds)
        if (picked) return { searchQuery, picked }
      } catch (err) {
        lastError = err
      }
    }
  }
  throw new Error(`No stock video found after ${queries.length} queries${lastError instanceof Error ? `: ${lastError.message}` : ''}`)
}
