import { PNG } from 'pngjs'

// Server-only: pulls the dominant colors out of a logo image so the "brand
// colors" are actually the logo's colors, not an unrelated page background
// or an arbitrary default. PNG only for now (favicons/logos are usually PNG
// or SVG) - ponytail: add jpeg-js/ico support if a real logo needs it.
const BUCKET = 24 // quantize each RGB channel to ~10 buckets to group near-identical colors

function toHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
}

export async function extractPalette(imageUrl: string, count = 3): Promise<string[] | null> {
  const res = await fetch(imageUrl)
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  // PNG signature check - anything else (jpeg, svg, ico) is out of scope for now.
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null

  let png: PNG
  try {
    png = PNG.sync.read(buf)
  } catch {
    return null
  }

  const counts = new Map<string, { count: number; r: number; g: number; b: number }>()
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i]
    const g = png.data[i + 1]
    const b = png.data[i + 2]
    const a = png.data[i + 3]
    if (a < 128) continue // transparent
    const brightness = (r + g + b) / 3
    if (brightness > 240 || brightness < 15) continue // near-white/near-black padding

    const key = `${Math.round(r / BUCKET)}-${Math.round(g / BUCKET)}-${Math.round(b / BUCKET)}`
    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, { count: 1, r, g, b })
    }
  }

  if (counts.size === 0) return null

  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, count)
    .map((c) => `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`)
}
