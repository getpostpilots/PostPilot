// The built-in LinkedIn playbook every draft is written against. Distilled and
// paraphrased from "Algorithm Insights Report 2026" by Richard van der Blom
// (RichardvanderBlom.Com BV), used with the author's permission to improve
// this product. Source: Algorithm Report 2026 - Richard van der Blom.

export const PLAYBOOK_SOURCE = 'Algorithm Report 2026 - Richard van der Blom'

// Rules the writer must follow. Shown read-only in Setup > Train your AI and
// injected into every generation prompt.
export const PLAYBOOK_RULES = [
  'Hook: the first 1-2 lines decide whether anyone clicks "see more". Make it personal and specific (a real number, a real situation), ideally counterintuitive or negative in angle. Never open with greetings or filler ("Happy Friday", "Hey LinkedIn").',
  'Promise: within three lines of the hook, say what the reader gets from reading on.',
  'Positioning: if you establish credibility, do it inside the post in fresh wording. Never append a repeated signature block or templated credentials.',
  'Core message: short paragraphs, generous line breaks, and numbered lists or old-way vs new-way contrast pairs so it scans on a phone. No walls of text.',
  'Length: 1,400 to 1,800 characters. Under 600 underperforms, over 2,000 loses readers before the end.',
  'Specificity beats generic advice. Every post needs at least one of: a surprising data point, a niche-specific scenario, or a perspective only this writer could offer. Prefer a real client, a real number, an actual decision over vague vulnerability.',
  'Conclusion: one deliberate line that lands the takeaway, then the call to engage.',
  'Call to engage: end with a specific closed question (yes/no or either/or, draws the most comments) or a specific open question (draws longer, deeper replies) or a bold closing statement. Never a commercial call to action ("DM me", "book a call") and never engagement bait ("comment YES to get X").',
  'No external links in the post body (they cost reach). No shortened or hidden links.',
  'Hashtags: 0 to 3, placed at the end, tightly on-topic. Never generic ones like #Success or #Motivation.',
  'Stay inside 2-3 anchor topics and reuse consistent topic keywords so the platform can classify the writer fast. Do not chase trending or off-topic subjects, and skip generic holiday or greeting posts.',
  'Sound human. Avoid over-polished, templated language and stock openers ("In today\'s fast-paced world"). AI drafts the structure, the lived detail and opinion must carry the substance.',
  'Tag people only when genuinely involved, inside a normal sentence, maximum 5.',
] as const

// What the writer (a human, after PostPilot publishes) should do next.
// Display only: PostPilot does not automate any of this.
export const NURTURE_CHECKLIST = [
  'Reply to every comment within 30 minutes. Replies with an opinion or follow-up question count most.',
  'Add two of your own comments in the first two hours (extra facts, a counterpoint), not just replies.',
  'Ask a small, relevant circle to comment in the first 15-30 minutes. Avoid closed pods.',
  'Do not edit the post in the first hour.',
  'Re-enter the comment thread on days 2 and 3.',
  'Repost your own post once, 4-6 hours later. Never twice.',
  'Spend real time commenting on others in your topic cluster: 30-50% of your LinkedIn time.',
  'Check results at day 3, 7 and 10, not just 48 hours.',
] as const

// Post shapes that hold up in 2026 (hard to fake, high save/comment odds).
export const STRUCTURES = [
  { id: 'case', label: 'Case story', guide: 'Challenge, then strategy, then tactics, then outcome, then the lesson. Use concrete specifics for the challenge and the tactics.' },
  { id: 'mistakes', label: 'Mistakes list', guide: '"X mistakes I made doing Y": a numbered list, one specific and counterintuitive mistake per line (surprising ones, not obvious ones).' },
  { id: 'contrast', label: 'Before/after contrast', guide: 'Old way vs new way as short contrast pairs, each pair readable in two lines max.' },
  { id: 'playbook', label: 'Playbook', guide: '3-5 steps, one per line, each short and immediately actionable and specific enough to be saved and reused.' },
] as const

export function pickStructure() {
  return STRUCTURES[Math.floor(Math.random() * STRUCTURES.length)]
}

// Post-generation checks against the hard rules above. Returns the problems
// found so generateDraft can ask the model to fix them once.
export function checkDraft(body: string): string[] {
  const issues: string[] = []
  const len = body.length
  if (len < 1200) issues.push(`too short (${len} characters, target 1,400-1,800)`)
  if (len > 2000) issues.push(`too long (${len} characters, target 1,400-1,800)`)
  if (/https?:\/\/|www\./i.test(body)) issues.push('contains a link, remove it')
  if (/\b(dm me|send me a dm|message me|book a call|link in (the )?comments?|comment\s+["']?\w+["']?\s+(below\s+)?(to get|and i))/i.test(body)) {
    issues.push('has a commercial call to action or engagement bait, replace with a genuine question')
  }
  // ponytail: a bold-statement close has no "?", so this only nudges; the model gets one retry, not a hard block.
  if (!/\?/.test(body.slice(-400))) issues.push('the ending has no specific question inviting replies')
  return issues
}

// Deterministic clean-up for rules that can be fixed without the model:
// keep at most 3 hashtags.
export function trimHashtags(body: string): string {
  let n = 0
  return body.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, (m) => (++n <= 3 ? m : ''))
}
