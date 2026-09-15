import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { encrypt, decrypt } from '../lib/crypto'
import { DEMO_MODE } from '../lib/demo-mode'
import { demoAccount, demoFounderPov, demoKeyStatus, demoPillars, demoVoiceProfile, logDemo, newDemoId } from '../lib/demo-data'

export const saveVoice = createServerFn({ method: 'POST' })
  .validator((data: { accountId: string; posts: string[] }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      demoVoiceProfile.source_posts = data.posts
      demoVoiceProfile.version += 1
      return demoVoiceProfile
    }
    const { user, supabase } = await requireUser()
    await supabase.from('voice_profiles').update({ active: false }).eq('account_id', data.accountId)
    const { data: row, error } = await supabase
      .from('voice_profiles')
      .insert({ user_id: user.id, account_id: data.accountId, source_posts: data.posts, active: true })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return row
  })

export const savePillars = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      accountId: string
      pillars: Array<{
        name: string
        description: string
        kind: 'founder' | 'product'
        targetShare: number
        ctaMechanic: 'discussion' | 'comment_gate'
      }>
    }) => data,
  )
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      demoPillars.length = 0
      demoPillars.push(
        ...data.pillars.map((p) => ({
          id: newDemoId(),
          account_id: demoAccount.id,
          name: p.name,
          description: p.description,
          kind: p.kind,
          target_share: p.targetShare,
          cta_mechanic: p.ctaMechanic,
          active: true,
        })),
      )
      return { count: demoPillars.length }
    }
    const { user, supabase } = await requireUser()
    await supabase.from('content_pillars').delete().eq('account_id', data.accountId)
    if (data.pillars.length === 0) return { count: 0 }
    const { error } = await supabase.from('content_pillars').insert(
      data.pillars.map((p) => ({
        user_id: user.id,
        account_id: data.accountId,
        name: p.name,
        description: p.description,
        kind: p.kind,
        target_share: p.targetShare,
        cta_mechanic: p.ctaMechanic,
      })),
    )
    if (error) throw new Error(error.message)
    return { count: data.pillars.length }
  })

export const saveFounderPov = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      accountId: string
      beliefs: Array<{ label: string; belief: string; challenges?: string; evidence?: string }>
    }) => data,
  )
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      demoFounderPov.length = 0
      demoFounderPov.push(
        ...data.beliefs.map((b) => ({
          id: newDemoId(),
          account_id: demoAccount.id,
          label: b.label,
          belief: b.belief,
          challenges: b.challenges ?? null,
          evidence: b.evidence ?? null,
        })),
      )
      return { count: demoFounderPov.length }
    }
    const { user, supabase } = await requireUser()
    await supabase.from('founder_pov').delete().eq('account_id', data.accountId)
    if (data.beliefs.length === 0) return { count: 0 }
    const { error } = await supabase.from('founder_pov').insert(
      data.beliefs.map((b) => ({
        user_id: user.id,
        account_id: data.accountId,
        label: b.label,
        belief: b.belief,
        challenges: b.challenges ?? null,
        evidence: b.evidence ?? null,
      })),
    )
    if (error) throw new Error(error.message)
    return { count: data.beliefs.length }
  })

export const saveConfig = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      accountId: string
      timezone: string
      dailyCap: number
      weeklyCap: number
      minGapMinutes: number
      primaryAudience: string
      secondaryAudience: string
    }) => data,
  )
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      Object.assign(demoAccount, {
        timezone: data.timezone,
        daily_cap: data.dailyCap,
        weekly_cap: data.weeklyCap,
        min_gap_minutes: data.minGapMinutes,
        primary_audience: data.primaryAudience,
        secondary_audience: data.secondaryAudience,
      })
      return { ok: true }
    }
    const { supabase } = await requireUser()
    const { error } = await supabase
      .from('linkedin_accounts')
      .update({
        timezone: data.timezone,
        daily_cap: data.dailyCap,
        weekly_cap: data.weeklyCap,
        min_gap_minutes: data.minGapMinutes,
        primary_audience: data.primaryAudience,
        secondary_audience: data.secondaryAudience,
      })
      .eq('id', data.accountId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const killSwitch = createServerFn({ method: 'POST' })
  .validator((data: { accountId: string; engaged: boolean }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      demoAccount.kill_switch_engaged = data.engaged
      logDemo(
        'publishing',
        data.engaged ? 'Publishing paused' : 'Publishing resumed',
        data.engaged ? 'Kill switch engaged by user.' : 'Kill switch released by user.',
        data.engaged ? 'warn' : 'info',
      )
      return { ok: true }
    }
    const { user, supabase } = await requireUser()
    const { error } = await supabase
      .from('linkedin_accounts')
      .update({ kill_switch_engaged: data.engaged })
      .eq('id', data.accountId)
    if (error) throw new Error(error.message)
    await supabase.from('decision_logs').insert({
      user_id: user.id,
      account_id: data.accountId,
      stage: 'publishing',
      decision: data.engaged ? 'Publishing paused' : 'Publishing resumed',
      rationale: data.engaged ? 'Kill switch engaged by user.' : 'Kill switch released by user.',
      level: data.engaged ? 'warn' : 'info',
    })
    return { ok: true }
  })

export const getKeyStatus = createServerFn({ method: 'GET' }).handler(async () => {
  if (DEMO_MODE) return demoKeyStatus
  const { user, supabase } = await requireUser()
  const { data } = await supabase.from('ai_keys').select('provider, model, base_url').eq('user_id', user.id).maybeSingle()
  if (!data) return { configured: false, usable: false, provider: null, model: null, baseUrl: null }
  return { configured: true, usable: true, provider: data.provider, model: data.model, baseUrl: data.base_url }
})

export const saveApiKey = createServerFn({ method: 'POST' })
  .validator((data: { apiKey: string; provider: string; model?: string; baseUrl?: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      Object.assign(demoKeyStatus, { configured: true, usable: true, provider: data.provider, model: data.model ?? null, baseUrl: data.baseUrl ?? null })
      return { ok: true }
    }
    const { user, supabase } = await requireUser()
    const { error } = await supabase.from('ai_keys').upsert(
      {
        user_id: user.id,
        provider: data.provider,
        api_key_enc: await encrypt(data.apiKey),
        model: data.model ?? null,
        base_url: data.baseUrl ?? null,
      },
      { onConflict: 'user_id' },
    )
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const removeApiKey = createServerFn({ method: 'POST' }).handler(async () => {
  if (DEMO_MODE) {
    Object.assign(demoKeyStatus, { configured: false, usable: false, provider: 'anthropic', model: null, baseUrl: null })
    return { ok: true }
  }
  const { user, supabase } = await requireUser()
  await supabase.from('ai_keys').delete().eq('user_id', user.id)
  return { ok: true }
})

// Server-only helper (not exposed as an RPC) for src/server/generation.ts to
// pull the caller's decrypted key without duplicating the lookup+decrypt.
// Never called in DEMO_MODE - generation.ts short-circuits before reaching it.
export async function resolveApiKey(userId: string, supabase: Awaited<ReturnType<typeof requireUser>>['supabase']) {
  const { data } = await supabase.from('ai_keys').select('*').eq('user_id', userId).maybeSingle()
  if (!data) return null
  return { ...data, apiKey: await decrypt(data.api_key_enc) }
}
