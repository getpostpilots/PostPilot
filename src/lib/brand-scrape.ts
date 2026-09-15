// Server-only: pulls a logo, accent color, and short description out of a
// website's <head> tags. No headless browser - just the raw HTML, which
// covers the vast majority of sites (og:image/favicon/meta description are
// close to universal). Real palette extraction (sampling the logo image's
// actual pixels) is a bigger lift - ponytail: add if theme-color meta turns
// out to be missing too often in practice.

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)
  return m ? m[1] : null
}

function findTags(html: string, tagName: string): string[] {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) ?? []
}

export type ScrapedBrand = {
  title: string | null
  description: string | null
  logoUrl: string | null
  themeColor: string | null
}

export async function scrapeBrand(url: string): Promise<ScrapedBrand> {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; PostPilotBrandBot/1.0)' } })
  if (!res.ok) throw new Error(`Could not fetch ${url}: ${res.status}`)
  const html = await res.text()

  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  const title = titleMatch ? titleMatch[1].trim() : null

  let description: string | null = null
  let ogImage: string | null = null
  let themeColor: string | null = null
  for (const tag of findTags(html, 'meta')) {
    const name = attr(tag, 'name') ?? attr(tag, 'property')
    const content = attr(tag, 'content')
    if (!name || !content) continue
    if (name === 'description' && !description) description = content
    if (name === 'og:description' && !description) description = content
    if (name === 'og:image') ogImage = content
    if (name === 'theme-color') themeColor = content
  }

  let iconHref: string | null = null
  for (const tag of findTags(html, 'link')) {
    const rel = attr(tag, 'rel')
    const href = attr(tag, 'href')
    if (rel && href && /icon/i.test(rel)) iconHref = href
  }

  const resolve = (href: string | null) => {
    if (!href) return null
    try {
      return new URL(href, url).toString()
    } catch {
      return null
    }
  }

  return {
    title,
    description,
    logoUrl: resolve(ogImage) ?? resolve(iconHref),
    themeColor,
  }
}
