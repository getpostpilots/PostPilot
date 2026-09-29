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

async function searchPexelsVideos(apiKey: string, query: string, perPage: number): Promise<StockVideoCandidate[]> {
  const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`, {
    headers: { Authorization: apiKey },
  })
  if (!res.ok) throw new Error(`Pexels video search failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as PexelsResponse

  return data.videos.flatMap((v) => {
    const slug = v.url.split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') ?? ''
    if (v.duration < MIN_SECONDS || v.duration > MAX_SECONDS || SLOWMO.test(slug)) return []
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

async function searchPixabayVideos(apiKey: string, query: string, perPage: number): Promise<StockVideoCandidate[]> {
  const res = await fetch(`https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=${perPage}`)
  if (!res.ok) throw new Error(`Pixabay video search failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as PixabayResponse

  return data.hits.flatMap((hit) => {
    // "small" keeps the re-upload light - always present alongside medium
    // per Pixabay's documented response shape.
    const file = hit.videos.small
    if (file.width < file.height) return [] // landscape only, matches the Pexels filter above
    if (hit.duration < MIN_SECONDS || hit.duration > MAX_SECONDS || SLOWMO.test(hit.tags)) return []
    return [{ provider: 'pixabay' as const, providerId: String(hit.id), videoUrl: file.url, thumbnailUrl: file.thumbnail, width: file.width, height: file.height, durationSeconds: hit.duration, description: hit.tags }]
  })
}

// Pools both providers' results, interleaved so neither dominates. Either
// key can be omitted (best-effort - see callers) and that provider is just
// skipped rather than failing the whole search.
export async function searchStockVideos(query: string, keys: { pexelsApiKey?: string | null; pixabayApiKey?: string | null }, perPage = 15): Promise<StockVideoCandidate[]> {
  const [pexels, pixabay] = await Promise.all([
    keys.pexelsApiKey ? searchPexelsVideos(keys.pexelsApiKey, query, perPage).catch(() => []) : Promise.resolve([]),
    keys.pixabayApiKey ? searchPixabayVideos(keys.pixabayApiKey, query, perPage).catch(() => []) : Promise.resolve([]),
  ])
  const pooled: StockVideoCandidate[] = []
  for (let i = 0; i < Math.max(pexels.length, pixabay.length); i++) {
    if (pexels[i]) pooled.push(pexels[i])
    if (pixabay[i]) pooled.push(pixabay[i])
  }
  return pooled
}
