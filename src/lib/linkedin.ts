// Server-only: LinkedIn OAuth (OpenID Connect) + the Posts/Images APIs.
// Requires a LinkedIn app with the "Sign In with LinkedIn using OpenID Connect"
// and "Share on LinkedIn" products added (developer.linkedin.com).

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo'
const POSTS_URL = 'https://api.linkedin.com/rest/posts'
const IMAGES_URL = 'https://api.linkedin.com/rest/images'
const LINKEDIN_API_VERSION = '202608' // bump periodically per LinkedIn's versioning docs - versions expire ~12mo after release

const SCOPES = ['openid', 'profile', 'w_member_social']

export function buildAuthUrl(state: string) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
    scope: SCOPES.join(' '),
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(code: string) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status} ${await res.text()}`)
  // { access_token, expires_in, refresh_token?, refresh_token_expires_in?, scope }
  return res.json() as Promise<{
    access_token: string
    expires_in: number
    refresh_token?: string
    scope: string
  }>
}

// LinkedIn only issues a refresh_token if the app has been granted
// programmatic refresh access - accounts connected before that (or without
// it) simply won't have one stored, and this will never be called for them.
export async function refreshAccessToken(refreshToken: string) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) throw new Error(`LinkedIn token refresh failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<{
    access_token: string
    expires_in: number
    refresh_token?: string
  }>
}

export async function fetchProfile(accessToken: string) {
  const res = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`LinkedIn userinfo failed: ${res.status} ${await res.text()}`)
  // { sub, name, email, picture, ... } - `sub` is the member id used to build the person URN
  return res.json() as Promise<{ sub: string; name: string; picture?: string }>
}

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
  if (!match) throw new Error('Expected a base64 data: URL')
  return { mimeType: match[1], bytes: new Uint8Array(Buffer.from(match[2], 'base64')) }
}

// Registers + uploads an image via LinkedIn's Images API, returns the
// resulting urn:li:image:... to reference from a post's content.media.
export async function uploadImage(accessToken: string, memberSub: string, imageDataUrl: string): Promise<string> {
  const { mimeType, bytes } = parseDataUrl(imageDataUrl)

  const initRes = await fetch(`${IMAGES_URL}?action=initializeUpload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${memberSub}` } }),
  })
  if (!initRes.ok) throw new Error(`LinkedIn image init failed: ${initRes.status} ${await initRes.text()}`)
  const init = (await initRes.json()) as { value: { uploadUrl: string; image: string } }

  // The uploadUrl is a pre-signed, single-use URL - no auth header needed here.
  // TS's DOM lib types Uint8Array as generic over ArrayBufferLike, which
  // BodyInit doesn't accept - same known mismatch as lib/crypto.ts.
  const uploadRes = await fetch(init.value.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body: bytes as BodyInit,
  })
  if (!uploadRes.ok) throw new Error(`LinkedIn image upload failed: ${uploadRes.status} ${await uploadRes.text()}`)

  return init.value.image
}

export async function publishPost(accessToken: string, memberSub: string, body: string, imageUrn?: string | null) {
  const res = await fetch(POSTS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
    },
    body: JSON.stringify({
      author: `urn:li:person:${memberSub}`,
      commentary: body,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      ...(imageUrn ? { content: { media: { id: imageUrn } } } : {}),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  })
  if (!res.ok) throw new Error(`LinkedIn publish failed: ${res.status} ${await res.text()}`)
  // Post URN comes back in the x-restli-id / x-linkedin-id response header, not the body.
  return res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id')
}
