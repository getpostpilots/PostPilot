// Demo mode: bypasses Supabase auth and swaps every server fn to operate on
// an in-memory fixture instead of Postgres/LinkedIn/an AI provider. Lets you
// click through the whole app with zero backend setup. State lives for the
// life of the dev server process only - restart it and demo data resets.
// Toggle with VITE_DEMO_MODE=true in .env. Vite inlines this at build time
// for both the client and the server bundle, so one flag covers both sides.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
