// Shared by generation.ts (per-pillar) and campaign-engine.ts (per-campaign) -
// both content_pillars and campaigns carry the same media_image/media_video/
// media_document/last_media_type columns, so one function decides which type
// to generate next regardless of which table the row came from.
export type MediaType = 'image' | 'video' | 'document'
export type MediaCheckbox = { media_image: boolean; media_video: boolean; media_document?: boolean | null; last_media_type: string | null }

const ORDER: MediaType[] = ['image', 'video', 'document']

// One box checked: always that type. Several: rotate in image/video/document
// order starting after whichever was used last (never the same type twice in
// a row, which the playbook penalises).
export function nextMediaType(row: MediaCheckbox): MediaType {
  const enabled = ORDER.filter((t) => (t === 'image' ? row.media_image : t === 'video' ? row.media_video : !!row.media_document))
  if (enabled.length === 0) return 'image'
  if (enabled.length === 1) return enabled[0]
  const i = enabled.indexOf(row.last_media_type as MediaType)
  return enabled[(i + 1) % enabled.length]
}
