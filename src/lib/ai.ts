import { getProvider } from './ai-providers'
import { PLAYBOOK_RULES, checkDraft, pickStructure, trimHashtags } from './linkedin-playbook'

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
  // Account-level "Train your AI" rules, appended after the built-in playbook.
  customRules?: string | null
}

function buildPrompt(ctx: GenerationContext, structure = pickStructure()): string {
  const beliefs = ctx.founderBeliefs
    .map((b) => `- ${b.label}: ${b.belief}${b.challenges ? ` (argues against: ${b.challenges})` : ''}`)
    .join('\n')
  const recent = ctx.recentPosts.slice(0, 10).map((p) => `---\n${p}`).join('\n')

  return [
    `Write one LinkedIn post for the pillar "${ctx.pillarName}": ${ctx.pillarDescription}`,
    ctx.pillarKind === 'founder'
      ? 'This is founder-led: the writer\'s own thinking is the subject. The product may appear once, as evidence, never as the pitch. Close by inviting disagreement or discussion, not a signup.'
      : 'This is product-led: the reader\'s problem is the subject, but the post must still land on a view the writer holds, not generic advice. Never include a link or a sales pitch.',
    ctx.primaryAudience ? `Primary audience: ${ctx.primaryAudience}.` : '',
    ctx.companyDescription ? `Company context: ${ctx.companyDescription}` : '',
    beliefs ? `Beliefs to draw from (do not invent opinions beyond these):\n${beliefs}` : '',
    ctx.voiceProfileSample ? `Match this voice exactly - sentence length, openers, words used/avoided:\n${ctx.voiceProfileSample}` : '',
    recent ? `Do not repeat these already-published posts:\n${recent}` : '',
    `LinkedIn playbook (follow every rule):\n${PLAYBOOK_RULES.map((r) => `- ${r}`).join('\n')}`,
    ctx.customRules?.trim() ? `The account owner's own rules (these take priority):\n${ctx.customRules.trim()}` : '',
    `Shape this post as a "${structure.label}": ${structure.guide}`,
    'Output only the post body, no preamble, no markdown. Up to 3 relevant hashtags at the very end are allowed, or none.',
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
  const prompt = buildPrompt(ctx)
  let draft = trimHashtags(stripEmDashes(await completeText(providerId, apiKey, model, baseUrlOverride, prompt, 1200)))
  const issues = checkDraft(draft)
  // One targeted retry when the draft breaks a hard playbook rule; keep whichever version has fewer problems.
  if (issues.length > 0) {
    const retry = trimHashtags(
      stripEmDashes(
        await completeText(providerId, apiKey, model, baseUrlOverride, `${prompt}

Your previous draft:
${draft}

Rewrite it fixing these problems: ${issues.join('; ')}. Output only the corrected post body.`, 1200),
      ),
    )
    if (checkDraft(retry).length <= issues.length) draft = retry
  }
  return draft
}
