// The learning loop: the owner logs results per published post (LinkedIn's
// analytics API needs a restricted scope this app does not have), and this
// turns them into (a) plain-language insights shown on the Published page and
// injected into prompts, and (b) a bias for which post shape to write next.
import { STRUCTURES, pickStructure } from './linkedin-playbook'

export type ResultPost = {
  structure: string | null
  video_url?: string | null
  image_data_url?: string | null
  document_slides?: unknown
  impressions: number | null
  reactions: number | null
  comments_count: number | null
  saves: number | null
  reposts: number | null
  published_at: string | null
}

export const RESULT_COLUMNS = 'structure, video_url, image_data_url, document_slides, impressions, reactions, comments_count, saves, reposts, published_at'

const MIN_LOGGED = 3 // overall, before any insight is shown
const MIN_GROUP = 2 // posts in a group before it is compared
const MIN_STRUCTURE_BIAS = 3 // posts of one shape before the writer is steered toward it

export function formatOf(p: Pick<ResultPost, 'video_url' | 'image_data_url' | 'document_slides'>): 'video' | 'carousel' | 'image' | 'text' {
  if (p.video_url) return 'video'
  if (p.document_slides) return 'carousel'
  if (p.image_data_url) return 'image'
  return 'text'
}

// Depth-weighted engagement: saves, reposts and comments count far more than
// reactions (the playbook's relative signal weights: 1 / ~9 / ~11 / ~15).
export function weightedEngagement(p: ResultPost): number {
  return (p.reactions ?? 0) + 9 * (p.comments_count ?? 0) + 11 * (p.reposts ?? 0) + 15 * (p.saves ?? 0)
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0
}

type Group = { name: string; n: number; reachRatio: number; depthRatio: number }

function groupBy(posts: ResultPost[], key: (p: ResultPost) => string | null, baseReach: number, baseDepth: number): Group[] {
  const map = new Map<string, ResultPost[]>()
  for (const p of posts) {
    const k = key(p)
    if (k) map.set(k, [...(map.get(k) ?? []), p])
  }
  return [...map.entries()]
    .filter(([, ps]) => ps.length >= MIN_GROUP)
    .map(([name, ps]) => ({
      name,
      n: ps.length,
      reachRatio: baseReach ? median(ps.map((p) => p.impressions ?? 0)) / baseReach : 0,
      depthRatio: baseDepth ? median(ps.map(weightedEngagement)) / baseDepth : 0,
    }))
    .sort((a, b) => b.reachRatio + b.depthRatio - (a.reachRatio + a.depthRatio))
}

const structureLabel = (id: string) => STRUCTURES.find((s) => s.id === id)?.label ?? id
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const bucket = (iso: string | null) => {
  if (!iso) return null
  const h = new Date(iso).getUTCHours() // ponytail: UTC; convert to the account timezone if this proves too coarse
  return h < 10 ? 'morning (before 10:00 UTC)' : h < 14 ? 'midday (10:00-14:00 UTC)' : h < 18 ? 'afternoon (14:00-18:00 UTC)' : 'evening'
}

export type Insights = { logged: number; lines: string[]; bestStructure: string | null }

export function computeInsights(all: ResultPost[]): Insights {
  const posts = all.filter((p) => p.impressions != null)
  if (posts.length < MIN_LOGGED) return { logged: posts.length, lines: [], bestStructure: null }

  const baseReach = median(posts.map((p) => p.impressions ?? 0))
  const baseDepth = median(posts.map(weightedEngagement))
  const lines: string[] = []
  const describe = (label: string, gs: Group[]) => {
    const best = gs[0]
    const worst = gs.length > 1 ? gs[gs.length - 1] : null
    if (best && (best.reachRatio >= 1.15 || best.depthRatio >= 1.15)) {
      lines.push(`${label}: "${best.name}" does best (${best.reachRatio.toFixed(1)}x your median reach, ${best.depthRatio.toFixed(1)}x your median depth-engagement, ${best.n} posts).`)
    }
    if (worst && worst !== best && worst.reachRatio <= 0.85 && worst.depthRatio <= 0.85) {
      lines.push(`${label}: "${worst.name}" is weakest (${worst.reachRatio.toFixed(1)}x reach, ${worst.depthRatio.toFixed(1)}x depth, ${worst.n} posts).`)
    }
  }

  const byStructure = groupBy(posts, (p) => (p.structure && STRUCTURES.some((s) => s.id === p.structure) ? p.structure : null), baseReach, baseDepth)
  describe('Post shape', byStructure.map((g) => ({ ...g, name: structureLabel(g.name) })))
  describe('Format', groupBy(posts, formatOf, baseReach, baseDepth))
  describe('Day', groupBy(posts, (p) => (p.published_at ? DAYS[new Date(p.published_at).getUTCDay()] : null), baseReach, baseDepth))
  describe('Time of day', groupBy(posts, (p) => bucket(p.published_at), baseReach, baseDepth))

  const top = byStructure[0]
  const bestStructure = top && top.n >= MIN_STRUCTURE_BIAS && top.reachRatio + top.depthRatio >= 2.3 ? top.name : null
  return { logged: posts.length, lines, bestStructure }
}

// Never the same shape twice in a row; lean toward the proven one half the
// time once there is enough data, otherwise rotate randomly to keep exploring.
export function chooseStructure(recent: ResultPost[], insights: Insights) {
  const last = recent[0]?.structure
  if (insights.bestStructure && insights.bestStructure !== last && Math.random() < 0.5) {
    return STRUCTURES.find((s) => s.id === insights.bestStructure) ?? pickStructure()
  }
  for (let i = 0; i < 10; i++) {
    const s = pickStructure()
    if (s.id !== last) return s
  }
  return pickStructure()
}

// Injected into generation prompts so wording, not just shape, follows results.
export function learningsPrompt(insights: Insights): string {
  return insights.lines.length ? `What has actually worked for this account (from logged results, lean into it):\n${insights.lines.map((l) => `- ${l}`).join('\n')}` : ''
}

// Fetches recent published posts with their logged results. Tolerates the
// results columns not existing yet (migration 0012 not run): returns [].
export async function loadResults(supabase: any, accountId: string): Promise<ResultPost[]> {
  const { data } = await supabase
    .from('posts')
    .select(RESULT_COLUMNS)
    .eq('account_id', accountId)
    .eq('state', 'published')
    .order('published_at', { ascending: false })
    .limit(40)
  return (data ?? []) as ResultPost[]
}
