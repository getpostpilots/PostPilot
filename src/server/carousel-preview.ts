import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '../lib/supabase-server'
import { renderCarouselPdf } from '../lib/carousel'
import { DEMO_MODE } from '../lib/demo-mode'

// Renders the exact PDF that publishing would upload, for the in-app preview.
// Returned as base64 (a few hundred KB at most) so the client can show it in
// an iframe via a blob URL without any storage or extra route.
export const previewCarousel = createServerFn({ method: 'POST' })
  .validator((data: { postId: string }) => data)
  .handler(async ({ data }) => {
    if (DEMO_MODE) throw new Error('Carousel preview is not available in demo mode.')
    const { supabase } = await requireUser()
    const { data: post } = await supabase.from('posts').select('account_id, document_title, document_slides').eq('id', data.postId).single()
    const doc = post?.document_slides as { slides?: Array<{ heading: string; body: string }>; cta?: string } | null
    if (!post || !doc?.slides?.length) throw new Error('This post has no carousel slides.')
    const { data: account } = await supabase.from('linkedin_accounts').select('brand_primary_color, brand_secondary_color').eq('id', post.account_id).single()
    const pdf = await renderCarouselPdf(
      { title: post.document_title || doc.slides[0].heading, caption: '', slides: doc.slides, cta: doc.cta || 'Save this for later' },
      { primary: account?.brand_primary_color, secondary: account?.brand_secondary_color },
    )
    return { pdfBase64: Buffer.from(pdf).toString('base64') }
  })
