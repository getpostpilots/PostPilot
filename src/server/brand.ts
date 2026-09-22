import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { scrapeBrand } from '../lib/brand-scrape'
import { extractPalette } from '../lib/color-extract'
import { DEMO_MODE } from '../lib/demo-mode'
import { demoAccount } from '../lib/demo-data'

// Read-only: fetches and parses the site, doesn't touch the DB. The Setup
// page lets the user review/edit the result before saveBrand persists it.
export const fetchBrandFromWebsite = createServerFn({ method: 'POST' })
  .validator((data: { url: string }) => data)
  .handler(async ({ data }) => {
    const url = /^https?:\/\//i.test(data.url.trim()) ? data.url.trim() : `https://${data.url.trim()}`
    if (DEMO_MODE) {
      return {
        title: 'LeadSync (Demo)',
        description: 'AI-powered lead automation for GoHighLevel agencies.',
        logoUrl: 'https://placehold.co/128x128?text=Logo',
        primaryColor: '#2563eb',
        secondaryColor: '#1e293b',
        tertiaryColor: null,
      }
    }
    const scraped = await scrapeBrand(url)

    // The logo's actual pixels are a much better source of "brand colors"
    // than a page's theme-color meta tag (which is often missing or just an
    // arbitrary accent) - prefer it when the logo is a decodable PNG.
    const palette = scraped.logoUrl ? await extractPalette(scraped.logoUrl, 3).catch(() => null) : null

    return {
      title: scraped.title,
      description: scraped.description,
      logoUrl: scraped.logoUrl,
      primaryColor: palette?.[0] ?? scraped.themeColor ?? null,
      secondaryColor: palette?.[1] ?? null,
      tertiaryColor: palette?.[2] ?? null,
    }
  })

export const saveBrand = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      accountId: string
      websiteUrl: string
      logoUrl: string
      primaryColor: string
      secondaryColor: string
      tertiaryColor: string
      description: string
    }) => data,
  )
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      Object.assign(demoAccount, {
        website_url: data.websiteUrl || null,
        logo_url: data.logoUrl || null,
        brand_primary_color: data.primaryColor || null,
        brand_secondary_color: data.secondaryColor || null,
        brand_tertiary_color: data.tertiaryColor || null,
        brand_description: data.description || null,
      })
      return { ok: true }
    }
    const { supabase } = await requireUser()
    const { error } = await supabase
      .from('linkedin_accounts')
      .update({
        website_url: data.websiteUrl || null,
        logo_url: data.logoUrl || null,
        brand_primary_color: data.primaryColor || null,
        brand_secondary_color: data.secondaryColor || null,
        brand_tertiary_color: data.tertiaryColor || null,
        brand_description: data.description || null,
      })
      .eq('id', data.accountId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// Guided "video style" profile - fed into the stock-search query builder
// (lib/video-ai.ts) instead of AI-generating video, same account-level
// pattern as saveBrand.
export const saveVideoStyle = createServerFn({ method: 'POST' })
  .validator((data: { accountId: string; description: string; include: string; avoid: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) {
      Object.assign(demoAccount, {
        video_style_description: data.description || null,
        video_style_include: data.include || null,
        video_style_avoid: data.avoid || null,
      })
      return { ok: true }
    }
    const { supabase } = await requireUser()
    const { error } = await supabase
      .from('linkedin_accounts')
      .update({
        video_style_description: data.description || null,
        video_style_include: data.include || null,
        video_style_avoid: data.avoid || null,
      })
      .eq('id', data.accountId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })
