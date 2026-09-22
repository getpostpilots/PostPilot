import { getProvider } from './ai-providers'

// Server-only: makes the actual HTTP call to the user's chosen provider with
// their decrypted BYO key. Never import this from client code.

export type GenerationContext = {
  voiceProfileSample: string | null
  pillarName: string
  pillarDescription: string
  pillarKind: 'founder' | 'product'
  founderBeliefs: Array<{ label: string; belief: string; challenges?: string; evidence?: string }>
  primaryAudience: string | null
  ctaMechanic: 'discussion' | 'comment_gate'
  recentPosts: string[]
  companyDescription: string | null
}

function buildPrompt(ctx: GenerationContext): string {
  const beliefs = ctx.founderBeliefs
    .map((b) => `- ${b.label}: ${b.belief}${b.challenges ? ` (argues against: ${b.challenges})` : ''}`)
    .join('\n')
  const recent = ctx.recentPosts.slice(0, 10).map((p) => `---\n${p}`).join('\n')

  return [
    `Write one LinkedIn post for the pillar "${ctx.pillarName}": ${ctx.pillarDescription}`,
    ctx.pillarKind === 'founder'
      ? 'This is founder-led: the writer\'s own thinking is the subject. The product may appear once, as evidence, never as the pitch. Close by inviting disagreement or discussion, not a signup.'
      : 'This is product-led: the reader\'s problem is the subject, but the post must still land on a view the writer holds, not generic advice. Close with a comment-gate prompt, not a link.',
    ctx.primaryAudience ? `Primary audience: ${ctx.primaryAudience}.` : '',
    ctx.companyDescription ? `Company context: ${ctx.companyDescription}` : '',
    beliefs ? `Beliefs to draw from (do not invent opinions beyond these):\n${beliefs}` : '',
    ctx.voiceProfileSample ? `Match this voice exactly - sentence length, openers, words used/avoided:\n${ctx.voiceProfileSample}` : '',
    recent ? `Do not repeat these already-published posts:\n${recent}` : '',
    'Output only the post body, no preamble, no hashtags, no markdown.',
    'Never use an em dash (—) anywhere in the post, under any circumstance. Use a period, comma, or short separate sentence instead.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Belt-and-suspenders: the prompt already forbids em dashes, but a model
// can still slip one in, so strip them from whatever comes back too. This
// is a hard rule, not just a request.
function stripEmDashes(text: string): string {
  return text.replace(/\s*—\s*/g, ' - ')
}

// Raw text-completion call against the user's chosen provider - shared by
// generateDraft (post bodies) and video-ai.ts (stock-search queries), so the
// two transport branches (Anthropic vs OpenAI-compatible) only live once.
export async function completeText(providerId: string, apiKey: string, model: string | undefined, baseUrlOverride: string | undefined, prompt: string, maxTokens = 700): Promise<string> {
  const provider = getProvider(providerId)
  const chosenModel = model?.trim() || provider.defaultModel

  if (provider.transport === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: chosenModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    return data.content?.[0]?.text?.trim() ?? ''
  }

  // OpenAI-compatible transport (OpenAI, OpenRouter, Groq, custom endpoints)
  const baseUrl = baseUrlOverride?.trim() || provider.baseUrl
  if (!baseUrl) throw new Error(`${provider.label} requires a base URL`)
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: chosenModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      // Gemini 2.5 Flash "thinks" before answering, and those reasoning
      // tokens count against max_tokens - without this the response gets
      // cut off mid-post before any visible text comes out. Scoped to
      // gemini since some other providers reject an unrecognized field.
      ...(providerId === 'gemini' ? { reasoning_effort: 'none' } : {}),
    }),
  })
  if (!res.ok) throw new Error(`${provider.label} request failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

export async function generateDraft(providerId: string, apiKey: string, model: string | undefined, baseUrlOverride: string | undefined, ctx: GenerationContext): Promise<string> {
  const text = await completeText(providerId, apiKey, model, baseUrlOverride, buildPrompt(ctx))
  return stripEmDashes(text)
}
