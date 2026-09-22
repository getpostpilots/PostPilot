import { completeText } from './ai'
import type { StockVideoCandidate } from './video-search'

export type VideoStyle = { description?: string | null; include?: string | null; avoid?: string | null }

function queryPrompt(topic: string, postBody: string, style: VideoStyle | undefined, recentQueries: string[]): string {
  return [
    'Turn this into a short stock-video search query: 3-6 words, no punctuation, no quotes, output only the query text and nothing else.',
    `Post topic: ${topic}`,
    `Post content for context: ${postBody.slice(0, 300)}`,
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
  const text = await completeText(providerId, apiKey, model, baseUrlOverride, queryPrompt(topic, postBody, style, recentQueries), 30)
  return text.replace(/["'.]/g, '').trim() || topic
}

// The whole "matching" logic: take the first pooled candidate not already
// used recently. Both search APIs already rank by relevance, so no separate
// scoring model is needed on top.
export function selectStockVideo(candidates: StockVideoCandidate[], recentProviderIds: string[]): StockVideoCandidate | null {
  if (candidates.length === 0) return null
  return candidates.find((c) => !recentProviderIds.includes(c.providerId)) ?? candidates[0]
}
