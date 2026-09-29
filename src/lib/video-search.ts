// Stock video search - Pexels + Pixabay, pooled together so one provider's
// catalog running dry on a niche query doesn't starve generation. Both offer
// free, no-attribution-required commercial licenses.

export type StockVideoCandidate = {
  provider: 'pexels' | 'pixabay'
  providerId: string
  videoUrl: string
  thumbnailUrl: string
  width: number
  height: number
  durationSeconds: number
  // Human-readable hint (Pexels url slug / Pixabay tags) so the AI can judge fit.
  description: string
}

// Eye-catching autoplay clips: long enough to read, short enough to hold.
const MIN_SECONDS = 5
const MAX_SECONDS = 30
const SLOWMO = /slow[\s-]?motion|slowmo/i
// `relaxed` (last-resort retry) drops only the length preference, never the slow-mo filter.
const okDuration = (d: number, relaxed: boolean) => relaxed || (d >= MIN_SECONDS && d <= MAX_SECONDS)

type PexelsResponse = {
  videos: Array<{
    id: number
    width: number
    height: number
    duration: number
    url: string
    image: string
    video_files: Array<{ quality: string; file_type: string; width: number; height: number; fps?: number; link: string }>
  }>
}

async function searchPexelsVideos(apiKey: string, query: string, perPage: number, relaxed: boolean): Promise<StockVideoCandidate[]> {
  const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`, {
    headers: { Authorization: apiKey },
  })
  if (!res.ok) throw new Error(`Pexels video search failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as PexelsResponse

  return data.videos.flatMap((v) => {
    const slug = v.url.split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') ?? ''
    if (!okDuration(v.duration, relaxed) || SLOWMO.test(slug)) return []
    // Normal-speed (<=30fps, high-fps sources are the slow-mo clips) mp4 nearest
    // 720p: sd (640x360) looked blurry on LinkedIn, 4K is needless upload weight.
    const file = v.video_files
      .filter((f) => f.file_type === 'video/mp4' && (f.fps ?? 30) <= 30.5)
      .sort((a, b) => Math.abs(a.width - 1280) - Math.abs(b.width - 1280))[0]
    if (!file) return []
    return [{ provider: 'pexels' as const, providerId: String(v.id), videoUrl: file.link, thumbnailUrl: v.image, width: file.width, height: file.height, durationSeconds: v.duration, description: slug }]
  })
}

type PixabayResponse = {
  hits: Array<{
    id: number
    duration: number
    tags: string
    videos: {
      small: { url: string; width: number; height: number; thumbnail: string }
    }
  }>
}

async function searchPixabayVideos(apiKey: string, query: string, perPage: number, relaxed: boolean): Promise<StockVideoCandidate[]> {
  const res = await fetch(`https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=${perPage}`)
  if (!res.ok) throw new Error(`Pixabay video search failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as PixabayResponse

  return data.hits.flatMap((hit) => {
    // "small" keeps the re-upload light - always present alongside medium
    // per Pixabay's documented response shape.
    const file = hit.videos.small
    if (file.width < file.height) return [] // landscape only, matches the Pexels filter above
    if (!okDuration(hit.duration, relaxed) || SLOWMO.test(hit.tags)) return []
    return [{ provider: 'pixabay' as const, providerId: String(hit.id), videoUrl: file.url, thumbnailUrl: file.thumbnail, width: file.width, height: file.height, durationSeconds: hit.duration, description: hit.tags }]
  })
}

// Pools both providers' results, interleaved so neither dominates. A provider
// with no key is skipped. If a provider errors (bad key, rate limit) and
// nothing came back at all, that error is thrown so callers can surface it
// instead of mistaking it for "no results".
export async function searchStockVideos(query: string, keys: { pexelsApiKey?: string | null; pixabayApiKey?: string | null }, perPage = 15, relaxed = false): Promise<StockVideoCandidate[]> {
  let firstError: unknown
  const guard = (p: Promise<StockVideoCandidate[]>) => p.catch((e) => { firstError ??= e; return [] as StockVideoCandidate[] })
  const [pexels, pixabay] = await Promise.all([
    keys.pexelsApiKey ? guard(searchPexelsVideos(keys.pexelsApiKey, query, perPage, relaxed)) : Promise.resolve([]),
    keys.pixabayApiKey ? guard(searchPixabayVideos(keys.pixabayApiKey, query, perPage, relaxed)) : Promise.resolve([]),
  ])
  const pooled: StockVideoCandidate[] = []
  for (let i = 0; i < Math.max(pexels.length, pixabay.length); i++) {
    if (pexels[i]) pooled.push(pexels[i])
    if (pixabay[i]) pooled.push(pixabay[i])
  }
  if (pooled.length === 0 && firstError) throw firstError
  return pooled
}
