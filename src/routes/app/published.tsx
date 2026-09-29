import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getPublishedPageData, listPosts } from '../../server/dashboard'
import { postHeading, postSource } from '../../lib/post-display'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { CarouselPreview } from '../../components/carousel-preview'
import { savePostResults } from '../../server/posts'
import { computeInsights, formatOf } from '../../lib/learning'

export const Route = createFileRoute('/app/published')({ component: Published })

const PAGE_SIZE = 30

function Published() {
  const [accountId, setAccountId] = useState<string | null>(null)
  const [posts, setPosts] = useState<any[] | null>(null)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  async function refresh() {
    setError('')
    try {
      const data = await getPublishedPageData({ data: { limit: PAGE_SIZE } })
      if (!data.account) return
      setAccountId(data.account.id)
      setPosts(data.posts)
      setHasMore(data.posts.length === PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load published posts.')
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  async function loadMore() {
    if (!accountId || !posts) return
    setLoadingMore(true)
    try {
      const more = await listPosts({ data: { accountId, states: ['published'], orderBy: 'published_at', offset: posts.length, limit: PAGE_SIZE } })
      setPosts([...posts, ...more])
      setHasMore(more.length === PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more.')
    } finally {
      setLoadingMore(false)
    }
  }

  if (error) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="w-fit" onClick={refresh}>Retry</Button>
      </div>
    )
  }
  if (!posts) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Published posts</h1>
        <p className="text-sm text-muted-foreground">Everything that's actually gone out on LinkedIn.</p>
      </div>

      <InsightsPanel posts={posts} />

      <div className="grid gap-2">
        {posts.length === 0 && <p className="text-sm text-muted-foreground">Nothing published yet.</p>}
        {posts.map((post) => (
          <PublishedRow key={post.id} post={post} onResults={(id, r) => setPosts((ps) => ps!.map((p) => (p.id === id ? { ...p, ...r } : p)))} />
        ))}
      </div>

      {hasMore && (
        <Button variant="outline" className="w-fit" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? 'Loading...' : 'Load more'}
        </Button>
      )}
    </div>
  )
}

function PublishedRow({ post, onResults }: { post: any; onResults: (id: string, r: Record<string, unknown>) => void }) {
  return (
    <Card>
      <CardContent className="p-0">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
            {post.image_data_url ? (
              <img src={post.image_data_url} alt="" className="h-10 w-10 shrink-0 rounded border object-cover" />
            ) : post.video_thumbnail_url ? (
              <img src={post.video_thumbnail_url} alt="" className="h-10 w-10 shrink-0 rounded border object-cover" />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded border bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{postHeading(post)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {postSource(post)} - {post.published_at ? new Date(post.published_at).toLocaleString() : ''}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="grid gap-3 border-t p-4">
            {post.image_data_url && <img src={post.image_data_url} alt="" className="max-h-96 w-fit rounded-md border object-cover" />}
            {post.video_url && <video src={post.video_url} poster={post.video_thumbnail_url ?? undefined} controls className="max-h-96 w-fit rounded-md border" />}
            <CarouselPreview post={post} />
            <p className="whitespace-pre-wrap text-sm">{post.body}</p>
            <ResultsForm post={post} onSaved={(r) => onResults(post.id, r)} />
            {post.linkedin_post_urn &&<p className="text-xs text-muted-foreground">LinkedIn URN: {post.linkedin_post_urn}</p>}
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

// What the logged results say works for this account. Also injected into every
// generation prompt (lib/learning.ts) and biases which post shape is written next.
function InsightsPanel({ posts }: { posts: any[] }) {
  const insights = computeInsights(posts)
  return (
    <Card>
      <CardContent className="grid gap-2 p-4 text-sm">
        <p className="font-medium">What's working for you</p>
        {insights.lines.length > 0 ? (
          <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">
            {insights.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            {insights.logged} of 3 posts logged. Open a published post, enter its numbers from LinkedIn (impressions, reactions, comments, saves, reposts) and PostPilot learns which post shapes, formats and times work for your account. Check posts again at day 3, 7 and 10, not just 48 hours.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

const FIELDS = [
  ['impressions', 'Impressions'],
  ['reactions', 'Reactions'],
  ['comments', 'Comments'],
  ['saves', 'Saves'],
  ['reposts', 'Reposts'],
] as const

function ResultsForm({ post, onSaved }: { post: any; onSaved: (r: Record<string, unknown>) => void }) {
  const init = (v: number | null) => (v == null ? '' : String(v))
  const [vals, setVals] = useState<Record<string, string>>({
    impressions: init(post.impressions),
    reactions: init(post.reactions),
    comments: init(post.comments_count),
    saves: init(post.saves),
    reposts: init(post.reposts),
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function save() {
    setBusy(true)
    setMsg('')
    try {
      const n = (k: string) => Number(vals[k]) || 0
      const r = await savePostResults({ data: { postId: post.id, impressions: n('impressions'), reactions: n('reactions'), comments: n('comments'), saves: n('saves'), reposts: n('reposts') } })
      onSaved({ impressions: r.impressions, reactions: r.reactions, comments_count: r.comments_count, saves: r.saves, reposts: r.reposts })
      setMsg('Saved.')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed to save results.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <p className="text-sm font-medium">Results ({formatOf(post)}{post.structure ? `, ${post.structure}` : ''})</p>
      <div className="flex flex-wrap items-end gap-2">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="grid gap-1 text-xs text-muted-foreground">
            {label}
            <Input className="h-8 w-24" type="number" min={0} value={vals[k]} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
          </label>
        ))}
        <Button size="sm" disabled={busy} onClick={save}>Save results</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </div>
  )
}
