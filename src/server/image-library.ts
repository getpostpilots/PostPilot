import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUser } from '../lib/supabase-server'

const BUCKET = 'image-library'
const SIGNED_URL_TTL = 300 // seconds - consumed immediately (rendered or fed to fetchImageAsDataUrl), no need for longer

// type-only - a value import of supabaseAdmin here (even just for
// `typeof supabaseAdmin`) drags supabase-server.ts's cookie/Node APIs into
// the client bundle, since single-file transpilers can't prove a type-only
// usage doesn't need the runtime binding. See resolveImageUrls below.
type LibraryClient = SupabaseClient
type LibraryRow = { id: string; url: string | null; storage_path: string | null }

// Turns image_library rows into one usable URL each, regardless of whether
// they came from an upload (storage_path, needs a signed URL since the
// bucket is private) or a pasted external URL (url, used as-is). Works with
// either requireUser()'s RLS-scoped client or supabaseAdmin() - both expose
// the same .storage API.
//
// Wrapped in createServerOnlyFn, not a plain exported function - this
// module is imported directly from routes/app/image-library.tsx (client
// code) for its createServerFn exports below, and a plain export here would
// drag supabase-server.ts's cookie/Node APIs into the client bundle and
// break the build, same trap as server/scheduler.ts and the
// runDueScheduledPosts fix in server/posts.ts.
export const resolveImageUrls = createServerOnlyFn(async (supabase: LibraryClient, rows: LibraryRow[]) => {
  const result = new Map<string, string>()
  const uploaded = rows.filter((r): r is LibraryRow & { storage_path: string } => !!r.storage_path)
  if (uploaded.length) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(
      uploaded.map((r) => r.storage_path),
      SIGNED_URL_TTL,
    )
    signed?.forEach((s, i) => {
      if (s.signedUrl) result.set(uploaded[i].id, s.signedUrl)
    })
  }
  for (const row of rows) {
    if (row.url) result.set(row.id, row.url)
  }
  return result
})

export const listLibraryImages = createServerFn({ method: 'GET' }).handler(async () => {
  const { user, supabase } = await requireUser()
  const { data: rows, error } = await supabase
    .from('image_library')
    .select('id, url, storage_path, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const signedUrls = await resolveImageUrls(supabase, rows ?? [])
  return (rows ?? [])
    .map((r) => ({ id: r.id, displayUrl: signedUrls.get(r.id), createdAt: r.created_at }))
    .filter((r): r is { id: string; displayUrl: string; createdAt: string } => !!r.displayUrl)
})

export const addLibraryImageByUrl = createServerFn({ method: 'POST' })
  .validator((data: { url: string }) => data)
  .handler(async ({ data }) => {
    const url = data.url.trim()
    if (!url) throw new Error('Enter an image URL.')
    const { user, supabase } = await requireUser()
    const { error } = await supabase.from('image_library').insert({ user_id: user.id, url })
    if (error) throw new Error(error.message)
    return { ok: true }
  })

// Called after the browser has already uploaded the file straight to
// Storage (see routes/app/image-library.tsx) - this just records the row.
export const recordLibraryUpload = createServerFn({ method: 'POST' })
  .validator((data: { storagePath: string }) => data)
  .handler(async ({ data }) => {
    const { user, supabase } = await requireUser()
    if (!data.storagePath.startsWith(`${user.id}/`)) throw new Error('Invalid upload path.')
    const { error } = await supabase.from('image_library').insert({ user_id: user.id, storage_path: data.storagePath })
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const deleteLibraryImage = createServerFn({ method: 'POST' })
  .validator((data: { imageId: string }) => data)
  .handler(async ({ data }) => {
    const { supabase } = await requireUser()
    const { data: row, error: fetchErr } = await supabase.from('image_library').select('storage_path').eq('id', data.imageId).single()
    if (fetchErr) throw new Error(fetchErr.message)
    if (row.storage_path) await supabase.storage.from(BUCKET).remove([row.storage_path])
    const { error } = await supabase.from('image_library').delete().eq('id', data.imageId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })
