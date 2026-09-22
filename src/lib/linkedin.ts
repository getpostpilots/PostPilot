// Server-only: LinkedIn OAuth (OpenID Connect) + the Posts/Images APIs.
// Requires a LinkedIn app with the "Sign In with LinkedIn using OpenID Connect"
// and "Share on LinkedIn" products added (developer.linkedin.com).

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo'
const POSTS_URL = 'https://api.linkedin.com/rest/posts'
const IMAGES_URL = 'https://api.linkedin.com/rest/images'
const VIDEOS_URL = 'https://api.linkedin.com/rest/videos'
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

type VideoInitResponse = {
  value: {
    video: string
    uploadToken: string
    uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>
  }
}

// Registers + uploads a video via LinkedIn's Videos API, returns the
// resulting urn:li:video:.... Unlike uploadImage this is a real multi-part
// flow: initialize (declares the size, gets back one uploadUrl per 4MB-ish
// part), PUT each byte-range part collecting its ETag, then finalize with
// those ETags as the uploadedPartIds.
export async function uploadVideo(accessToken: string, memberSub: string, videoUrl: string): Promise<string> {
  const sourceRes = await fetch(videoUrl)
  if (!sourceRes.ok) throw new Error(`Fetching source video failed: ${sourceRes.status}`)
  const bytes = Buffer.from(await sourceRes.arrayBuffer())

  const initRes = await fetch(`${VIDEOS_URL}?action=initializeUpload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
    },
    body: JSON.stringify({
      initializeUploadRequest: { owner: `urn:li:person:${memberSub}`, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false },
    }),
  })
  if (!initRes.ok) throw new Error(`LinkedIn video init failed: ${initRes.status} ${await initRes.text()}`)
  const init = (await initRes.json()) as VideoInitResponse

  const uploadedPartIds: string[] = []
  for (const part of init.value.uploadInstructions) {
    const partRes = await fetch(part.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes.subarray(part.firstByte, part.lastByte + 1) as BodyInit,
    })
    if (!partRes.ok) throw new Error(`LinkedIn video part upload failed: ${partRes.status} ${await partRes.text()}`)
    const etag = partRes.headers.get('etag')
    if (!etag) throw new Error('LinkedIn video part upload did not return an ETag')
    uploadedPartIds.push(etag.replace(/^"|"$/g, ''))
  }

  const finalizeRes = await fetch(`${VIDEOS_URL}?action=finalizeUpload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
    },
    body: JSON.stringify({ finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken, uploadedPartIds } }),
  })
  if (!finalizeRes.ok) throw new Error(`LinkedIn video finalize failed: ${finalizeRes.status} ${await finalizeRes.text()}`)

  return init.value.video
}

// Shared by every publish call site: a post carries either video_url or
// image_data_url (never both), upload whichever is set and hand back its
// media URN for publishPost. Replaces what used to be the same
// `image_data_url ? uploadImage(...) : null` line duplicated 4 times.
export async function uploadPostMedia(
  accessToken: string,
  memberSub: string,
  post: { video_url?: string | null; image_data_url?: string | null },
): Promise<{ urn: string; kind: 'image' | 'video' } | null> {
  if (post.video_url) return { urn: await uploadVideo(accessToken, memberSub, post.video_url), kind: 'video' }
  if (post.image_data_url) return { urn: await uploadImage(accessToken, memberSub, post.image_data_url), kind: 'image' }
  return null
}

export async function publishPost(accessToken: string, memberSub: string, body: string, mediaUrn?: string | null) {
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
      ...(mediaUrn ? { content: { media: { id: mediaUrn } } } : {}),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  })
  if (!res.ok) throw new Error(`LinkedIn publish failed: ${res.status} ${await res.text()}`)
  // Post URN comes back in the x-restli-id / x-linkedin-id response header, not the body.
  return res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id')
}
