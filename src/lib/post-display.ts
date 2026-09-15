// Shared display logic between the Scheduled Posts and Published Posts
// pages - a "heading" and "source" label derived from what's already on
// the post row (pillar/campaign joins), no extra queries needed.
export function postHeading(post: any): string {
  return post.topic ?? post.content_pillars?.name ?? post.body.slice(0, 60) + (post.body.length > 60 ? '...' : '')
}

export function postSource(post: any): string {
  if (post.campaigns?.name) return `Campaign: ${post.campaigns.name}`
  if (post.content_pillars?.name) return `Manual - generated from "${post.content_pillars.name}"`
  return 'Manual - written by hand'
}
