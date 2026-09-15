import { createFileRoute } from '@tanstack/react-router'
import { getCookie, deleteCookie } from '@tanstack/react-start/server'
import { requireUser } from '../../../lib/supabase-server'
import { encrypt } from '../../../lib/crypto'
import { exchangeCodeForToken, fetchProfile } from '../../../lib/linkedin'
import { STATE_COOKIE } from '../../../server/linkedin'

// LinkedIn redirects the browser here with ?code&state after the user
// approves the app. This has to be a real server route (not a createServerFn
// RPC) because LinkedIn itself, not our client code, is the one navigating here.
export const Route = createFileRoute('/api/linkedin/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const expectedState = getCookie(STATE_COOKIE)
        deleteCookie(STATE_COOKIE)

        // Not Response.redirect(): that produces a Response with immutable
        // headers, which crashes when the framework tries to merge the
        // Set-Cookie header (from deleteCookie above) onto it. A plain
        // Response with a Location header behaves the same but stays mutable.
        const redirectTo = (path: string) => new Response(null, { status: 302, headers: { Location: `${process.env.VITE_SITE_URL}${path}` } })
        const fail = (reason: string) => redirectTo(`/app?oauth_error=${encodeURIComponent(reason)}`)

        if (!code || !state || state !== expectedState) return fail('LinkedIn authorization was invalid or expired. Try connecting again.')

        try {
          const { user, supabase } = await requireUser()
          const token = await exchangeCodeForToken(code)
          const profile = await fetchProfile(token.access_token)

          const { error } = await supabase.from('linkedin_accounts').upsert(
            {
              user_id: user.id,
              display_name: profile.name,
              avatar_url: profile.picture ?? null,
              member_sub: profile.sub,
              access_token_enc: await encrypt(token.access_token),
              refresh_token_enc: token.refresh_token ? await encrypt(token.refresh_token) : null,
              token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
            },
            { onConflict: 'user_id,member_sub' },
          )
          if (error) return fail(error.message)

          return redirectTo('/app')
        } catch (err) {
          return fail(err instanceof Error ? err.message : 'Connecting LinkedIn failed.')
        }
      },
    },
  },
})
