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
}

type PexelsResponse = {
  videos: Array<{
    id: number
    width: number
    height: number
    duration: number
    image: string
    video_files: Array<{ quality: string; file_type: string; width: number; height: number; link: string }>
  }>
}

async function searchPexelsVideos(apiKey: string, query: string, perPage: number): Promise<StockVideoCandidate[]> {
  const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`, {
    headers: { Authorization: apiKey },
  })
  if (!res.ok) throw new Error(`Pexels video search failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as PexelsResponse

  return data.videos.flatMap((v) => {
    // Prefer a modest mp4 rendition (LinkedIn's chunked upload re-fetches and
    // re-uploads these bytes server-side, so smaller keeps memory sane) -
    // sd quality if available, else the smallest mp4 on offer.
    const mp4s = v.video_files.filter((f) => f.file_type === 'video/mp4')
    if (mp4s.length === 0) return []
    const file = mp4s.find((f) => f.quality === 'sd') ?? mp4s.sort((a, b) => a.width - b.width)[0]
    return [{ provider: 'pexels' as const, providerId: String(v.id), videoUrl: file.link, thumbnailUrl: v.image, width: file.width, height: file.height, durationSeconds: v.duration }]
  })
}

type PixabayResponse = {
  hits: Array<{
    id: number
    duration: number
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
    return [{ provider: 'pixabay' as const, providerId: String(hit.id), videoUrl: file.url, thumbnailUrl: file.thumbnail, width: file.width, height: file.height, durationSeconds: hit.duration }]
  })
}

// Pools both providers' results, interleaved so neither dominates. Either
// key can be omitted (best-effort - see callers) and that provider is just
// skipped rather than failing the whole search.
export async function searchStockVideos(query: string, keys: { pexelsApiKey?: string | null; pixabayApiKey?: string | null }, perPage = 5): Promise<StockVideoCandidate[]> {
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
