# PostPilot architecture

Modeled directly on Cadence's compiled client bundle (the reference dump this
was built from). Same shape, different stack choices: TanStack Start instead
of raw TanStack Start+seroval RPC framework Cadence hand-rolled, Supabase for
everything, LinkedIn's official Posts API, bring-your-own AI key.

## Stack

- **App**: TanStack Start (React 19, file-based routes, `createServerFn` RPC, Tailwind v4, shadcn/ui)
- **Data**: Supabase (Postgres + Auth + RLS). Every table is owned by exactly one `auth.users` row.
- **LinkedIn**: OAuth 2.0 (OpenID Connect + `w_member_social`) against LinkedIn's official Posts API — no browser automation.
- **AI**: bring-your-own key (Anthropic, OpenAI, OpenRouter, Groq, or a custom OpenAI-compatible endpoint), encrypted at rest, billed to the user's own provider account.

## Directory map

```
src/
  lib/                    Framework-agnostic logic, split client vs server-only
    supabase.ts           Browser Supabase client (cookie-synced session)
    supabase-server.ts    Server-only clients: requireUser() (RLS-scoped), supabaseAdmin() (bypasses RLS)
    crypto.ts             AES-256-GCM encrypt/decrypt for tokens + API keys at rest
    ai-providers.ts       BYO-key provider registry (id, transport, default model, key hint)
    ai.ts                 Builds the generation prompt, calls the chosen provider
    linkedin.ts           OAuth URL builder, token exchange, userinfo, publish (Posts API)
  server/                 createServerFn RPCs - the only place that touches the DB or secrets
    dashboard.ts          getDashboard - aggregate read for Overview
    linkedin.ts           startLinkedIn - builds the OAuth redirect URL
    settings.ts           Voice / pillars / founder POV / config / AI key / kill switch
    posts.ts              Queue CRUD, approve, publish (with kill-switch + audit logging)
    generation.ts         generateForPillar, topUpQueue, listGenerationJobs
  routes/
    index.tsx              Marketing landing page
    app/route.tsx           Console shell: session check -> <AuthForm/> or sidebar + <Outlet/>
    app/index.tsx            Overview (metrics, connect CTA, recent activity)
    app/queue.tsx             Content queue (compose, generate, approve/schedule/publish/edit)
    app/decisions.tsx         Audit trail (every decision_logs row)
    app/setup.tsx             Configuration (AI key, voice, pillars, founder POV, publishing limits, kill switch)
    api/linkedin/callback.ts  Real HTTP route (not an RPC) - LinkedIn redirects the browser here
supabase/migrations/0001_init.sql   Full schema + RLS policies
```

## Data model

One `linkedin_accounts` row per connected profile, everything else denormalizes
`user_id` onto itself so RLS is a flat `auth.uid() = user_id` check instead of
a join per row:

- **linkedin_accounts** — encrypted tokens, kill switch, pacing limits (daily/weekly cap, min gap), audience
- **ai_keys** — one BYO key per user, encrypted, provider + model + optional base URL
- **voice_profiles** — versioned; only one `active` at a time per account
- **content_pillars** — `kind` (founder/product) × `target_share` × `cta_mechanic` (discussion/comment_gate)
- **founder_pov** — labeled beliefs the generator is allowed to argue from, nothing invented
- **posts** — `draft → approved/scheduled → published`, or `killed`/`failed`
- **generation_jobs** — one row per generation attempt, for the "still writing" UI and history
- **decision_logs** — append-only audit trail; every automated action writes one row here

## Flows worth knowing

**Auth.** Email/password via Supabase, session synced into cookies by
`@supabase/ssr` (not just localStorage) so server functions can identify the
caller. `app/route.tsx` does the session check client-side and swaps between
`<AuthForm/>` and the console shell — same pattern Cadence used.

**LinkedIn connect.** `startLinkedIn()` (an RPC) stashes a CSRF nonce in a
cookie and returns the LinkedIn authorization URL; the client redirects the
whole browser there. LinkedIn redirects back to `/api/linkedin/callback`,
which **has to be a real file-route HTTP handler**, not a `createServerFn` —
LinkedIn is the one navigating the browser there, not our client code calling
an RPC. That handler exchanges the code, fetches the profile, and upserts
`linkedin_accounts`.

**Generation.** `generateForPillar` runs inline in the request (see the
`ponytail:` comment in `generation.ts`) — builds a prompt from the active
voice profile + the pillar + founder beliefs + last 10 published posts (so it
doesn't repeat itself), calls the user's provider, inserts a `draft` post,
and logs the decision. `topUpQueue` just picks whichever active pillar is
furthest under its `target_share` among published posts.

**Publishing.** `publishNow` checks the kill switch first, then calls
`publishPost()` (LinkedIn Posts API), and writes a `decision_logs` row either
way — success or failure, so the audit trail never has a gap.

**Video posts.** Checkboxes on a pillar (manual generation) or a campaign
(automatic ticks) pick image, video, or both - `server/media-type.ts`'s
`nextMediaType` alternates when both are checked, tracked via the row's own
`last_media_type`. Video isn't AI-generated: `lib/video-ai.ts` turns the post
+ the account's "video style" profile (Setup) into a short search query,
`lib/video-search.ts` pools results from Pexels + Pixabay, and the top match
gets uploaded to LinkedIn via `lib/linkedin.ts`'s `uploadVideo` (a real
multi-part flow, unlike the single-PUT image upload).

**Safety rails currently wired up:**
- Kill switch (`linkedin_accounts.kill_switch_engaged`) — `publishNow` refuses if set
- Full audit trail (`decision_logs`) — every generate/edit/approve/schedule/publish/pause writes a row
- Encrypted tokens and API keys (AES-256-GCM, `lib/crypto.ts`)
- RLS on every table — a user can only ever see their own rows

## Known gaps / next audit pass

These are deliberate simplifications, not oversights — flagging them for the
audit rather than building them speculatively:

1. ~~No scheduler.~~ Fixed: `server/posts.ts`'s `runDueScheduledPosts` finds
   due `scheduled` posts and publishes them via the same path as
   `publishNow`; `server/scheduler.ts`'s tick calls it alongside
   `runDueCampaigns`.
2. **No pacing enforcement for manually-scheduled posts.** `daily_cap` /
   `weekly_cap` / `min_gap_minutes`
   are stored and shown in Setup, but nothing checks them before publishing
   yet (campaigns already enforce them in `runCampaign`). Cadence enforced
   these before releasing a post — same should happen in
   `runDueScheduledPosts` (item 1).
3. **No token refresh.** `linkedin_accounts.refresh_token_enc` is stored but
   nothing uses it yet to renew an expiring `access_token`. Needs a check +
   refresh call before publish, or a scheduled job that renews accounts
   nearing `token_expires_at`.
4. **Generation runs inline**, not in a background worker/queue — fine for a
   personal tool, would need to move to a real queue if generation gets slow
   or usage grows (see the `ponytail:` comment in `generation.ts`).
5. **No fact-checking / repetition gate beyond "don't repeat the last 10
   posts."** Cadence had an explicit voice/fact/repetition check stage before
   a draft could be approved; this version trusts the human reviewing the
   queue to catch that.
6. **Supabase types aren't generated yet** (`src/lib/supabase.ts` has a note)
   — run `npx supabase gen types typescript` once the project is linked, and
   wire it into `createClient<Database>(...)` in both `supabase.ts` and
   `supabase-server.ts`. Until then a handful of spots (`queue.tsx`,
   `setup.tsx`) lean on inferred `any` from the untyped client.
7. **No LinkedIn app approval yet.** LinkedIn requires the app to have the
   "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn"
   products added in the developer console before OAuth will actually work
   end to end — this is an account-setup step, not a code gap.
8. **No "AI-assisted draft this field" buttons** in Setup (Cadence auto-drafted
   pillars/audience/beliefs from a brief) — every field is hand-typed for now.
9. **Landing page and console are unstyled beyond shadcn defaults** — Cadence's
   actual visual design (dark theme, custom CSS) wasn't ported, just the
   structure and flows.

## Setup to actually run this

1. Create a Supabase project, run every file in `supabase/migrations/` against
   it, in order (`0001_init.sql` through the latest).
2. Copy `.env.example` to `.env`, fill in the Supabase URL/keys. `PEXELS_API_KEY`
   / `PIXABAY_API_KEY` are optional - only needed for video-enabled pillars/campaigns.
3. Generate an encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. Create a LinkedIn app at developer.linkedin.com, add "Sign In with LinkedIn
   using OpenID Connect" + "Share on LinkedIn" products, set the redirect URL
   to `<site>/api/linkedin/callback`, fill in the client id/secret.
5. `npm run dev`
