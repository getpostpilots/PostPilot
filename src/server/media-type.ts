// Shared by generation.ts (per-pillar) and campaign-engine.ts (per-campaign) -
// both content_pillars and campaigns carry the same media_image/media_video/
// last_media_type columns, so one function decides which type to generate
// next regardless of which table the row came from.
export type MediaCheckbox = { media_image: boolean; media_video: boolean; last_media_type: string | null }

export function nextMediaType(row: MediaCheckbox): 'image' | 'video' {
  if (row.media_video && !row.media_image) return 'video'
  if (row.media_image && !row.media_video) return 'image'
  // Both checked (or neither, which the UI prevents) - alternate.
  return row.last_media_type === 'video' ? 'image' : 'video'
}
