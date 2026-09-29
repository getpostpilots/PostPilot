// Document (carousel) posts: the AI writes the slides, we render them to a PDF
// at publish time and upload it as a native LinkedIn document. Rules follow
// the playbook (lib/linkedin-playbook.ts): 7-11 slides total, one idea per
// slide, unbranded cover with a benefit + curiosity cue, one CTA on the last
// slide, and a short 300-400 character caption that does not preview slides.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
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
- slides: ${MIN_SLIDES} to ${MAX_SLIDES} content slides. Each has ONE idea: a heading (max 8 words) and a body (max 28 words). Concrete and specific (real numbers, scenarios, steps), never generic tips or motivational quotes. Readable on a phone.
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

// --- PDF rendering -------------------------------------------------------

const W = 1080
const H = 1350 // 4:5, the tall mobile-first size
const MARGIN = 96

// Standard PDF fonts only cover WinAnsi; map common typography, drop the rest.
function clean(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•●]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7e\xa1-\xff\n]/g, '')
}

function hexToRgb(hex: string | null | undefined, fallback: [number, number, number]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return rgb(...fallback)
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

function luminance(c: { red: number; green: number; blue: number }) {
  return 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of clean(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  return lines
}

// Largest size (down to `min`) at which the wrapped text fits `maxHeight`.
function fit(text: string, font: PDFFont, max: number, min: number, maxWidth: number, maxHeight: number) {
  for (let size = max; size >= min; size -= 2) {
    const lines = wrap(text, font, size, maxWidth)
    if (lines.length * size * 1.25 <= maxHeight) return { size, lines }
  }
  return { size: min, lines: wrap(text, font, min, maxWidth) }
}

export async function renderCarouselPdf(c: Carousel, brand?: { primary?: string | null; secondary?: string | null }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const primary = hexToRgb(brand?.primary, [0.039, 0.4, 0.761]) // LinkedIn-ish blue fallback
  const accent = hexToRgb(brand?.secondary, [0.95, 0.6, 0.1])
  const onPrimary = luminance(primary) > 0.6 ? rgb(0.08, 0.08, 0.1) : rgb(1, 1, 1)
  const dark = rgb(0.09, 0.1, 0.13)
  const muted = rgb(0.32, 0.35, 0.4)
  const total = c.slides.length + 2

  const drawBlock = (page: ReturnType<typeof pdf.addPage>, text: string, font: PDFFont, top: number, max: number, min: number, maxHeight: number, color: ReturnType<typeof rgb>) => {
    const { size, lines } = fit(text, font, max, min, W - MARGIN * 2, maxHeight)
    let y = H - top
    for (const line of lines) {
      y -= size
      page.drawText(line, { x: MARGIN, y, size, font, color })
      y -= size * 0.25
    }
    return H - y // bottom edge from top
  }

  // Cover: brand background, big benefit headline, curiosity nudge. No logo/branding.
  const cover = pdf.addPage([W, H])
  cover.drawRectangle({ x: 0, y: 0, width: W, height: H, color: primary })
  drawBlock(cover, c.title, bold, 380, 96, 56, 620, onPrimary)
  cover.drawRectangle({ x: MARGIN, y: 210, width: 140, height: 10, color: accent })
  cover.drawText('Swipe', { x: MARGIN, y: 140, size: 40, font: regular, color: onPrimary })

  c.slides.forEach((s, i) => {
    const page = pdf.addPage([W, H])
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.973, 0.98, 0.988) })
    page.drawRectangle({ x: 0, y: H - 24, width: W, height: 24, color: primary })
    page.drawText(`${String(i + 1).padStart(2, '0')}`, { x: MARGIN, y: H - 210, size: 120, font: bold, color: accent })
    const bottom = drawBlock(page, s.heading, bold, 300, 88, 52, 340, dark)
    if (s.body) drawBlock(page, s.body, regular, bottom + 40, 54, 36, H - bottom - 40 - 200, muted)
    page.drawText(`${i + 2} / ${total}`, { x: W - MARGIN - 110, y: 80, size: 30, font: regular, color: muted })
  })

  const last = pdf.addPage([W, H])
  last.drawRectangle({ x: 0, y: 0, width: W, height: H, color: primary })
  drawBlock(last, c.cta, bold, 460, 80, 48, 520, onPrimary)
  last.drawRectangle({ x: MARGIN, y: 300, width: 140, height: 10, color: accent })

  return pdf.save()
}
