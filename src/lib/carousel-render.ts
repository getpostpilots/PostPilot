// Renders a carousel to a PDF (1080x1350, the tall mobile-first size) with
// pdf-lib. Dark tinted theme derived from the two brand colours, Poppins
// (embedded, see carousel-fonts.ts), giant ghost numerals, progress pills.
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { POPPINS_EXTRABOLD, POPPINS_REGULAR, POPPINS_SEMIBOLD } from './carousel-fonts'
import type { Carousel } from './carousel'

const W = 1080
const H = 1350
const MARGIN = 96
const LEADING = 1.18

// Poppins (Latin subset) covers typographic punctuation; map/drop the rest.
function clean(text: string): string {
  return text
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7e\xa1-\xff‘’“”…•\n]/g, '')
}

type RGB = ReturnType<typeof rgb>

function hexToRgb(hex: string | null | undefined, fallback: [number, number, number]): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return rgb(...fallback)
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const luminance = (c: RGB) => 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue
const mix = (a: RGB, b: RGB, t: number): RGB => rgb(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t)
const BLACK = rgb(0.03, 0.035, 0.05)
const WHITE = rgb(1, 1, 1)

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

type Fit = { size: number; lines: string[] }

// Largest size (down to `min`) at which the wrapped text fits `maxHeight`.
function fit(text: string, font: PDFFont, max: number, min: number, maxWidth: number, maxHeight: number): Fit {
  for (let size = max; size >= min; size -= 2) {
    const lines = wrap(text, font, size, maxWidth)
    if (lines.length * size * LEADING <= maxHeight) return { size, lines }
  }
  return { size: min, lines: wrap(text, font, min, maxWidth) }
}

const height = (f: Fit) => f.lines.length * f.size * LEADING

export async function renderCarouselPdf(c: Carousel, brand?: { primary?: string | null; secondary?: string | null }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const heavy = await pdf.embedFont(POPPINS_EXTRABOLD, { subset: true })
  const semi = await pdf.embedFont(POPPINS_SEMIBOLD, { subset: true })
  const regular = await pdf.embedFont(POPPINS_REGULAR, { subset: true })

  // Theme: dark tinted background for contrast in a bright feed, bright accent for emphasis.
  const primary = hexToRgb(brand?.primary, [0.15, 0.4, 0.95])
  let accent = hexToRgb(brand?.secondary, [0.98, 0.78, 0.2])
  if (luminance(accent) < 0.4) accent = mix(accent, WHITE, 0.45) // keep the accent readable on dark
  const bg = mix(primary, BLACK, 0.86)
  const bgSoft = mix(primary, BLACK, 0.72)
  const ghost = mix(bg, primary, 0.28) // giant background numeral
  const soft = mix(WHITE, bg, 0.22)
  const onAccent = luminance(accent) > 0.55 ? BLACK : WHITE
  const total = c.slides.length + 2
  const textW = W - MARGIN * 2
  type Page = ReturnType<typeof pdf.addPage>

  // Draws pre-fitted lines from `top` (distance from the page top); returns the bottom edge.
  const drawLines = (page: Page, f: Fit, font: PDFFont, top: number, color: RGB, lineColor?: (i: number) => RGB) => {
    let y = H - top
    f.lines.forEach((line, i) => {
      y -= f.size
      page.drawText(line, { x: MARGIN, y, size: f.size, font, color: lineColor ? lineColor(i) : color })
      y -= f.size * (LEADING - 1)
    })
    return H - y
  }
  const pill = (page: Page, x: number, y: number, w: number, h: number, color: RGB) => {
    const r = h / 2
    page.drawRectangle({ x: x + r, y, width: w - h, height: h, color })
    page.drawCircle({ x: x + r, y: y + r, size: r, color })
    page.drawCircle({ x: x + w - r, y: y + r, size: r, color })
  }
  const arrow = (page: Page, x: number, y: number, len: number, thickness: number, color: RGB) => {
    const head = len * 0.32
    page.drawLine({ start: { x, y }, end: { x: x + len, y }, thickness, color })
    page.drawLine({ start: { x: x + len, y }, end: { x: x + len - head, y: y + head }, thickness, color })
    page.drawLine({ start: { x: x + len, y }, end: { x: x + len - head, y: y - head }, thickness, color })
  }
  const backdrop = (page: Page, base: RGB) => page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: base })

  // ---- Cover: brand blob, eyebrow pill, huge headline with its last line highlighted, swipe cue.
  const cover = pdf.addPage([W, H])
  backdrop(cover, bg)
  cover.drawCircle({ x: W - 60, y: H - 80, size: 560, color: primary, opacity: 0.5 })
  cover.drawCircle({ x: 40, y: 60, size: 420, color: accent, opacity: 0.16 })
  const eyebrow = `${c.slides.length} IDEAS INSIDE`
  const ew = semi.widthOfTextAtSize(eyebrow, 38) + 76
  pill(cover, MARGIN, H - 262, ew, 86, accent)
  cover.drawText(eyebrow, { x: MARGIN + 38, y: H - 262 + 27, size: 38, font: semi, color: onAccent })
  const cf = fit(c.title, heavy, 132, 68, textW, 720)
  const cTop = Math.max(330, (H - height(cf)) / 2 - 20)
  const cBottom = drawLines(cover, cf, heavy, cTop, WHITE, (i) => (cf.lines.length > 1 && i === cf.lines.length - 1 ? accent : WHITE))
  cover.drawRectangle({ x: MARGIN, y: H - cBottom - 70, width: 180, height: 14, color: accent })
  pill(cover, MARGIN, 96, 330, 92, accent)
  cover.drawText('SWIPE', { x: MARGIN + 44, y: 96 + 30, size: 34, font: heavy, color: onAccent })
  arrow(cover, MARGIN + 200, 96 + 46, 84, 8, onAccent)

  // ---- Content slides: giant ghost numeral, accent bar, heading + body, progress pills.
  c.slides.forEach((s, i) => {
    const page = pdf.addPage([W, H])
    backdrop(page, bg)
    page.drawCircle({ x: W + 40, y: H + 20, size: 420, color: bgSoft })
    const num = String(i + 1).padStart(2, '0')
    const numSize = 460
    page.drawText(num, { x: W - MARGIN - heavy.widthOfTextAtSize(num, numSize) + 30, y: H - 420, size: numSize, font: heavy, color: ghost })

    const hf = fit(s.heading, heavy, 112, 60, textW, 470)
    const gap = s.body ? 56 : 0
    // Body takes whatever room is left above the progress row, shrinking (down to 30pt) rather than overflowing.
    const bf = s.body ? fit(s.body, regular, 62, 32, textW, H - 250 - 380 - height(hf) - gap) : null
    const block = height(hf) + gap + (bf ? height(bf) : 0)
    const top = Math.max(430, Math.min((H - block) / 2 + 40, H - 250 - block))
    page.drawRectangle({ x: MARGIN, y: H - top + 40, width: 140, height: 14, color: accent })
    const bottom = drawLines(page, hf, heavy, top, WHITE)
    if (bf) drawLines(page, bf, regular, bottom + gap, soft)

    // Progress: one dot per slide, the current one stretched into an accent pill.
    let x = MARGIN
    for (let k = 0; k < total; k++) {
      const on = k === i + 1
      const w = on ? 64 : 18
      pill(page, x, 96, w, 18, on ? accent : mix(bg, WHITE, 0.25))
      x += w + 14
    }
  })

  // ---- Closing slide: solid accent background, bookmark icon, one big action.
  const last = pdf.addPage([W, H])
  backdrop(last, accent)
  last.drawCircle({ x: W - 80, y: 120, size: 520, color: mix(accent, primary, 0.5), opacity: 0.35 })
  last.drawSvgPath('M0 0 H104 V150 L52 108 L0 150 Z', { x: MARGIN, y: H - 190, color: onAccent })
  const lf = fit(c.cta, heavy, 104, 60, textW, 620)
  const lTop = Math.max(400, (H - height(lf)) / 2 + 20)
  drawLines(last, lf, heavy, lTop, onAccent)
  return pdf.save()
}
