// Document (carousel) posts: the AI writes the slides, we render them to a PDF
// at publish time and upload it as a native LinkedIn document. Rules follow
// the playbook (lib/linkedin-playbook.ts): 7-11 slides total, one idea per
// slide, unbranded cover with a benefit + curiosity cue, one CTA on the last
// slide, and a short 300-400 character caption that does not preview slides.
import { completeText, type GenerationContext } from './ai'
import { PLAYBOOK_RULES } from './linkedin-playbook'

export type CarouselSlide = { heading: string; body: string }
export type Carousel = { title: string; caption: string; slides: CarouselSlide[]; cta: string }

const MIN_SLIDES = 5 // content slides; plus cover + CTA = 7 total minimum
const MAX_SLIDES = 8 // ... = 10 total, inside the 7-11 window

function carouselPrompt(ctx: GenerationContext): string {
  return [
    `Design a LinkedIn document carousel for the topic "${ctx.pillarName}": ${ctx.pillarDescription}`,
    ctx.primaryAudience ? `Primary audience: ${ctx.primaryAudience}.` : '',
    ctx.companyDescription ? `Company context: ${ctx.companyDescription}` : '',
    ctx.recentPosts.length ? `Do not repeat these already-published posts:\n${ctx.recentPosts.slice(0, 5).map((p) => `---\n${p.slice(0, 300)}`).join('\n')}` : '',
    `Carousel rules:
- title: the cover slide headline, max 10 words. State the benefit and add a curiosity cue. No company branding.
- slides: ${MIN_SLIDES} to ${MAX_SLIDES} content slides. Each has ONE idea: a punchy heading (max 7 words, a bold claim not a label) and a body (max 22 words, short sentences). Concrete and specific (scenarios, steps), never generic tips or motivational quotes. It is read on a phone, so every word must earn its place.
- cta: the final slide, exactly ONE clear action in max 14 words (e.g. "Save this for your next intake review"). Never two actions, no selling.
- caption: 300 to 380 characters (count carefully, never over 400). One personal hook and one specific question at the end. Do not preview or list the slides. No links, no hashtags.`,
    `General writing rules:\n${PLAYBOOK_RULES.slice(0, 6).map((r) => `- ${r}`).join('\n')}`,
    ctx.learnings ?? '',
    ctx.customRules?.trim() ? `The account owner's own rules (priority):\n${ctx.customRules.trim()}` : '',
    'Never invent statistics, percentages, client names, results or anecdotes. Only use numbers and stories that appear in the context above; otherwise use sharp reasoning or an explicitly hypothetical scenario ("Picture an agency that...") and no fake numbers.',
    'Never use an em dash anywhere.',
    'Output ONLY valid JSON: {"title": string, "caption": string, "slides": [{"heading": string, "body": string}], "cta": string}',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function parseCarousel(text: string): Carousel | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const raw = JSON.parse(text.slice(start, end + 1))
    const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s*—\s*/g, ', ').trim() : '')
    const slides = (Array.isArray(raw.slides) ? raw.slides : [])
      .map((s: any) => ({ heading: str(s?.heading), body: str(s?.body) }))
      .filter((s: CarouselSlide) => s.heading)
      .slice(0, MAX_SLIDES)
    const c = { title: str(raw.title), caption: str(raw.caption), slides, cta: str(raw.cta) }
    return c.title && c.caption && c.cta && c.slides.length >= MIN_SLIDES ? c : null
  } catch {
    return null
  }
}

// One retry on unparseable/too-thin output; throws so media stays mandatory
// (callers treat a throw as "could not produce the required media").
export async function generateCarousel(providerId: string, apiKey: string, model: string | undefined, baseUrl: string | undefined, ctx: GenerationContext): Promise<Carousel> {
  const prompt = carouselPrompt(ctx)
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = parseCarousel(await completeText(providerId, apiKey, model, baseUrl, prompt, 2500))
    if (c) return c
  }
  throw new Error('Carousel generation failed: the model did not return a usable slide set after 2 attempts.')
}

// PDF rendering lives in carousel-render.ts; re-exported so callers keep one import.
export { renderCarouselPdf } from './carousel-render'
