import { randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { setCookie } from '@tanstack/react-start/server'
import { requireUser } from '../lib/supabase-server'
import { buildAuthUrl, refreshAccessToken } from '../lib/linkedin'
import { decrypt, encrypt } from '../lib/crypto'

const STATE_COOKIE = 'li_oauth_state'

// Kicks off the OAuth dance: stashes a CSRF nonce in a short-lived cookie,
// hands the client the LinkedIn authorization URL to redirect to. The actual
// token exchange happens in routes/api/linkedin/callback.ts once LinkedIn
// redirects back (see that file for why this can't just be another server fn).
export const startLinkedIn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireUser() // just to guarantee only logged-in users can start this

  const state = randomBytes(16).toString('hex')
  setCookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return { url: buildAuthUrl(state) }
})

export { STATE_COOKIE }

// Called by anything about to publish (posts.ts, campaign-engine.ts). Uses
// the stored token if it's still got more than 5 minutes left, otherwise
// refreshes it via the refresh_token and persists the new tokens. Accepts a
// generic supabase client since callers include the service-role one
// (background scheduler, no request/RLS context).
export async function getValidAccessToken(account: any, supabase: any): Promise<string> {
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return decrypt(account.access_token_enc)
  }

  if (!account.refresh_token_enc) {
    throw new Error('LinkedIn connection has expired - reconnect LinkedIn from Overview.')
  }

  try {
    const refreshToken = await decrypt(account.refresh_token_enc)
    const refreshed = await refreshAccessToken(refreshToken)
    await supabase
      .from('linkedin_accounts')
      .update({
        access_token_enc: await encrypt(refreshed.access_token),
        refresh_token_enc: refreshed.refresh_token ? await encrypt(refreshed.refresh_token) : account.refresh_token_enc,
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq('id', account.id)
    return refreshed.access_token
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    throw new Error(`LinkedIn connection has expired and refreshing failed - reconnect LinkedIn from Overview. (${message})`)
  }
}
