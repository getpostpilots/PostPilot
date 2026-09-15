// In-memory fixture used only when DEMO_MODE is on (see demo-mode.ts). Module
// state, so it persists across requests for one dev-server process and resets
// on restart - no database involved.
let seq = 0
const nextId = () => `demo-${++seq}`
const now = () => new Date().toISOString()

export const demoAccount = {
  id: 'demo-account',
  display_name: 'Kurt (Demo)',
  avatar_url: null as string | null,
  kill_switch_engaged: false,
  primary_audience: 'Founders and revenue leaders at B2B SaaS companies',
  secondary_audience: 'Sales ops managers and growth marketers',
  timezone: 'America/New_York',
  daily_cap: 1,
  weekly_cap: 5,
  min_gap_minutes: 240,
  website_url: null as string | null,
  logo_url: null as string | null,
  brand_primary_color: null as string | null,
  brand_secondary_color: null as string | null,
  brand_tertiary_color: null as string | null,
  brand_description: null as string | null,
  created_at: now(),
}

export type DemoPillar = {
  id: string
  account_id: string
  name: string
  description: string
  kind: 'founder' | 'product'
  target_share: number
  cta_mechanic: 'discussion' | 'comment_gate'
  active: boolean
}

export const demoPillars: DemoPillar[] = [
  {
    id: 'demo-pillar-founder',
    account_id: demoAccount.id,
    name: 'Founder POV',
    description: 'A stated belief about founder-led growth, argued against the common assumption it contradicts.',
    kind: 'founder',
    target_share: 0.5,
    cta_mechanic: 'discussion',
    active: true,
  },
  {
    id: 'demo-pillar-product',
    account_id: demoAccount.id,
    name: 'Outbound strategy',
    description: 'How outbound actually gets built and where it breaks, for the person accountable for pipeline.',
    kind: 'product',
    target_share: 0.5,
    cta_mechanic: 'comment_gate',
    active: true,
  },
]

export type DemoFounderPov = {
  id: string
  account_id: string
  label: string
  belief: string
  challenges: string | null
  evidence: string | null
}

export const demoFounderPov: DemoFounderPov[] = [
  { id: 'demo-pov-1', account_id: demoAccount.id, label: 'Headcount is the wrong lever', belief: 'Most pipeline problems get solved with a process fix, not another hire.', challenges: 'Hiring an SDR fixes pipeline', evidence: null },
  { id: 'demo-pov-2', account_id: demoAccount.id, label: 'Lists beat copy', belief: 'Targeting decides the outcome; copy only decides the margin.', challenges: null, evidence: null },
  { id: 'demo-pov-3', account_id: demoAccount.id, label: 'Automate the boring parts only', belief: 'Automation should remove busywork, never the judgment calls that actually move a deal.', challenges: null, evidence: null },
]

export const demoVoiceProfile = {
  id: 'demo-voice',
  account_id: demoAccount.id,
  version: 1,
  active: true,
  source_posts: [
    'Spent three years thinking outbound was a copywriting problem. It was a targeting problem the whole time.',
    "We didn't scale by hiring. We scaled by deleting the steps that only existed because we were scared to trust the process.",
  ],
}

export type DemoPost = {
  id: string
  account_id: string
  pillar_id: string | null
  body: string
  state: 'draft' | 'approved' | 'scheduled' | 'published' | 'killed' | 'failed'
  scheduled_at: string | null
  published_at: string | null
  linkedin_post_urn: string | null
  kill_reason: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

export const demoPosts: DemoPost[] = [
  {
    id: 'demo-post-1',
    account_id: demoAccount.id,
    pillar_id: 'demo-pillar-founder',
    body: "I stopped hiring against a problem that runs on minutes. Headcount was the wrong answer and it took me two quarters to admit it.\n\nWhat did you over-hire for before realizing it was a process problem?",
    state: 'published',
    scheduled_at: null,
    published_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    linkedin_post_urn: 'urn:li:share:demo1',
    kill_reason: null,
    failure_reason: null,
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'demo-post-2',
    account_id: demoAccount.id,
    pillar_id: 'demo-pillar-product',
    body: 'Most outbound programs die from targeting, not messaging. Before you rewrite a single subject line, look at who is actually on the list.\n\nWhat is the one filter that changed your reply rate the most?',
    state: 'draft',
    scheduled_at: null,
    published_at: null,
    linkedin_post_urn: null,
    kill_reason: null,
    failure_reason: null,
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
]

type DemoLog = {
  id: string
  account_id: string
  post_id: string | null
  stage: string
  decision: string
  rationale: string
  level: 'info' | 'warn' | 'error'
  created_at: string
}

export const demoLogs: DemoLog[] = [
  {
    id: 'demo-log-1',
    account_id: demoAccount.id,
    post_id: 'demo-post-1',
    stage: 'release',
    decision: 'Published',
    rationale: 'Posted to LinkedIn via the Posts API.',
    level: 'info',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'demo-log-2',
    account_id: demoAccount.id,
    post_id: 'demo-post-2',
    stage: 'generation',
    decision: 'Draft written',
    rationale: 'Generated for pillar "Outbound strategy" from voice profile and founder POV.',
    level: 'info',
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
]

export const demoKeyStatus = {
  configured: true,
  usable: true,
  provider: 'anthropic',
  model: null as string | null,
  baseUrl: null as string | null,
}

export function logDemo(stage: string, decision: string, rationale: string, level: DemoLog['level'] = 'info', postId: string | null = null) {
  demoLogs.unshift({ id: nextId(), account_id: demoAccount.id, post_id: postId, stage, decision, rationale, level, created_at: now() })
}

export function findDemoPillar(pillarId: string | null) {
  return demoPillars.find((p) => p.id === pillarId) ?? null
}

export function withPillar<T extends { pillar_id: string | null }>(post: T) {
  const pillar = findDemoPillar(post.pillar_id)
  return { ...post, content_pillars: pillar ? { name: pillar.name, kind: pillar.kind } : null }
}

export function newDemoId() {
  return nextId()
}

export function demoNow() {
  return now()
}
