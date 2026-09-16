// Supporting-image generation via Gemini's native image model ("Nano
// Banana"). This is separate from lib/ai.ts's OpenAI-compatible text path
// because image output isn't exposed through that compatibility layer -
// it needs Gemini's own generateContent endpoint with responseModalities.
const IMAGE_MODEL = 'gemini-3.1-flash-image'

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } }
type GeminiResponse = { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }

// Returns a data: URL (small enough to store inline on the post row) or null
// if the model declined to produce an image for the prompt. `referenceImages`
// (data: URLs) are sent alongside the prompt as style/mood inspiration -
// capped at 3 so the request stays a reasonable size.
export async function generateImage(apiKey: string, prompt: string, referenceImages?: string[]): Promise<string | null> {
  const imageParts = (referenceImages ?? []).slice(0, 3).flatMap((dataUrl) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
    return m ? [{ inlineData: { mimeType: m[1], data: m[2] } }] : []
  })

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  })
  if (!res.ok) throw new Error(`Gemini image generation failed: ${res.status} ${await res.text()}`)

  const data = (await res.json()) as GeminiResponse
  const imagePart = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!imagePart?.inlineData) return null
  return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`
}

export function imagePromptFor(pillarName: string, postBody: string, brand?: Brand): string {
  const palette = [brand?.primaryColor, brand?.secondaryColor, brand?.tertiaryColor].filter(Boolean)
  return [
    `A single professional, editorial-style photograph or illustration to accompany a LinkedIn post about "${pillarName}".`,
    `Post content for context: ${postBody.slice(0, 400)}`,
    brand?.description ? `Company this represents: ${brand.description}` : '',
    palette.length ? `Lean on this brand color palette where it fits naturally (lighting, accents, props) - don't force it: ${palette.join(', ')}.` : '',
    'No text, no logos, no watermarks in the image. Clean, modern, business-appropriate.',
  ]
    .filter(Boolean)
    .join('\n')
}

type Brand = { description?: string | null; primaryColor?: string | null; secondaryColor?: string | null; tertiaryColor?: string | null }

// A user-typed prompt (e.g. "in the brand colors, an image of a rocket
// launching, matching the post") is the main instruction; we still append
// the actual hex codes, post context, and a couple of safety defaults so it
// stays grounded even if the user's wording is vague.
export function customImagePromptFor(userPrompt: string, postBody: string, brand?: Brand): string {
  const palette = [brand?.primaryColor, brand?.secondaryColor, brand?.tertiaryColor].filter(Boolean)
  return [
    userPrompt,
    `Post this image supports: ${postBody.slice(0, 400)}`,
    brand?.description ? `Company this represents: ${brand.description}` : '',
    palette.length ? `Brand colors to draw from: ${palette.join(', ')}.` : '',
    'No watermarks. Clean, modern, business-appropriate, unless the prompt explicitly asks otherwise.',
  ]
    .filter(Boolean)
    .join('\n')
}

// Auto-generation for a campaign topic. `recentPrompts` are past image
// prompts already used by this campaign, passed so the model doesn't keep
// drawing the same scene; `hasReferenceImages` just changes the wording
// since the actual images are sent as separate parts, not text.
export function campaignImagePromptFor(
  topic: string,
  postBody: string,
  brand: Brand | undefined,
  recentPrompts: string[],
  hasReferenceImages: boolean,
): string {
  const palette = [brand?.primaryColor, brand?.secondaryColor, brand?.tertiaryColor].filter(Boolean)
  return [
    `A single professional, editorial-style photograph or illustration to accompany a LinkedIn post about "${topic}".`,
    `Post content for context: ${postBody.slice(0, 400)}`,
    brand?.description ? `Company this represents: ${brand.description}` : '',
    palette.length ? `Lean on this brand color palette where it fits naturally (lighting, accents, props) - don't force it: ${palette.join(', ')}.` : '',
    hasReferenceImages
      ? "The attached images set the visual direction - match their palette, composition, tone, and the general kind of subject matter (e.g. if they're abstract/tech visuals with no people, keep this one abstract with no people too; if they show people in a setting, it's fine to include people in a similar setting). Don't reproduce any of them exactly or copy an identifiable real scene - generate a new, original image in the same visual family."
      : '',
    recentPrompts.length
      ? `Already used for this campaign - come up with a different scene/angle, not a variation of these:\n${recentPrompts.map((p) => `- ${p}`).join('\n')}`
      : '',
    'No text, no logos, no watermarks in the image. Clean, modern, business-appropriate.',
  ]
    .filter(Boolean)
    .join('\n')
}

// Fetches an existing image (e.g. a scraped brand logo) and inlines it as a
// data: URL, so it can be stored/uploaded the same way as a generated image.
export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png'
  const bytes = new Uint8Array(await res.arrayBuffer())
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:${mimeType};base64,${btoa(binary)}`
}
