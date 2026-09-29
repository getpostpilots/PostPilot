// Inserts a generated post. `extras` are columns from migration 0012
// (structure, document_*), which is run by hand in the SQL Editor - so if the
// deploy lands first, retry without them rather than failing every generation.
// Never for document posts: dropping the slides would silently publish text-only.
export async function insertPost(supabase: any, row: Record<string, unknown>, extras: Record<string, unknown>) {
  const first = await supabase.from('posts').insert({ ...row, ...extras }).select().single()
  if (!first.error || 'document_slides' in extras || !/column/i.test(first.error.message)) return first
  return supabase.from('posts').insert(row).select().single()
}
