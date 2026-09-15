import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getDashboard } from '../../server/dashboard'
import { deletePost, publishNow, setPostState, updatePostBody } from '../../server/posts'
import { listCampaigns, postCampaignNowFn } from '../../server/campaigns'
import { postHeading, postSource } from '../../lib/post-display'
import { nextRunMinutesFromNow } from '../../lib/timezones'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'

export const Route = createFileRoute('/app/scheduled')({ component: Scheduled })

type UpNextItem =
  | { kind: 'post'; id: string; post: any; sortMinutes: number }
  | { kind: 'campaign'; id: string; campaign: any; nextTopic: string | null; sortMinutes: number | null }

function Scheduled() {
  const [account, setAccount] = useState<any>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function refresh() {
    try {
      const data = await getDashboard()
      const acc = data.accounts[0] ?? null
      setAccount(acc)
      setPosts(data.posts)
      if (acc) setCampaigns(await listCampaigns({ data: { accountId: acc.id } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.')
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    setError('')
    setMessage('')
    try {
      const result = await fn()
      if (result && typeof result === 'object' && 'status' in result) {
        const r = result as { status: string; reason?: string }
        setMessage(r.status === 'posted' ? 'Posted to LinkedIn.' : r.status === 'failed' ? `Failed: ${r.reason}` : `Not posted: ${r.reason}`)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusyId(null)
    }
  }

  if (!account && error) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="w-fit" onClick={() => { setError(''); refresh() }}>Retry</Button>
      </div>
    )
  }
  if (!account) return <p className="text-sm text-muted-foreground">Loading...</p>

  const scheduledPosts = posts.filter((p) => p.state === 'scheduled')
  const drafts = posts.filter((p) => ['draft', 'approved', 'failed'].includes(p.state))

  const upNext: UpNextItem[] = [
    ...scheduledPosts.map((post) => ({
      kind: 'post' as const,
      id: post.id,
      post,
      sortMinutes: post.scheduled_at ? (new Date(post.scheduled_at).getTime() - Date.now()) / 60000 : Infinity,
    })),
    ...campaigns
      .filter((c) => c.status === 'active')
      .map((c) => {
        const topics = c.campaign_topics ?? []
        return {
          kind: 'campaign' as const,
          id: c.id,
          campaign: c,
          nextTopic: topics.length ? topics[c.next_topic_index % topics.length]?.topic : null,
          sortMinutes: nextRunMinutesFromNow(account.timezone || 'UTC', c.days_of_week, c.post_time, c.last_run_date),
        }
      }),
  ].sort((a, b) => (a.sortMinutes ?? Infinity) - (b.sortMinutes ?? Infinity))

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Scheduled posts</h1>
        <p className="text-sm text-muted-foreground">What's about to go out - manually scheduled posts, and each active campaign's next run.</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="grid gap-2">
        {upNext.length === 0 && <p className="text-sm text-muted-foreground">Nothing scheduled. Schedule a draft below, or set up a campaign.</p>}
        {upNext.map((item) =>
          item.kind === 'post' ? (
            <ScheduledPostRow key={item.id} post={item.post} busy={busyId === item.id} onBusy={(fn) => run(item.id, fn)} />
          ) : (
            <CampaignNextRow key={item.id} campaign={item.campaign} nextTopic={item.nextTopic} busy={busyId === item.id} onBusy={(fn) => run(item.id, fn)} />
          ),
        )}
      </div>

      {drafts.length > 0 && (
        <div className="grid gap-3">
          <h2 className="text-lg font-semibold">Drafts awaiting review</h2>
          <div className="grid gap-2">
            {drafts.map((post) => (
              <ScheduledPostRow key={post.id} post={post} busy={busyId === post.id} onBusy={(fn) => run(post.id, fn)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CampaignNextRow({ campaign, nextTopic, busy, onBusy }: { campaign: any; nextTopic: string | null; busy: boolean; onBusy: (fn: () => Promise<unknown>) => void }) {
  return (
    <Card>
      <CardContent className="p-0">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
            <div className="h-10 w-10 shrink-0 rounded border bg-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{nextTopic ?? 'No topics configured'}</p>
              <p className="truncate text-xs text-muted-foreground">Campaign: {campaign.name}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="grid gap-3 border-t p-4">
            <p className="text-sm text-muted-foreground">
              This hasn't been generated yet - the campaign writes it fresh (text + image) the moment its scheduled time arrives.
            </p>
            <Button size="sm" variant="outline" disabled={busy} className="w-fit" onClick={() => onBusy(() => postCampaignNowFn({ data: { campaignId: campaign.id } }))}>
              Post now
            </Button>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

function ScheduledPostRow({ post, busy, onBusy }: { post: any; busy: boolean; onBusy: (fn: () => Promise<unknown>) => void }) {
  const [body, setBody] = useState(post.body)
  const [scheduleAt, setScheduleAt] = useState('')
  const dirty = body.trim() !== post.body.trim()

  return (
    <Card>
      <CardContent className="p-0">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
            {post.image_data_url ? (
              <img src={post.image_data_url} alt="" className="h-10 w-10 shrink-0 rounded border object-cover" />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded border bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{postHeading(post)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {postSource(post)} - {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : 'Not yet scheduled'}
              </p>
            </div>
            <Badge variant={post.state === 'failed' ? 'destructive' : 'secondary'}>{post.state}</Badge>
            <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="grid gap-3 border-t p-4">
            {post.image_data_url && <img src={post.image_data_url} alt="" className="max-h-96 w-fit rounded-md border object-cover" />}
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} disabled={busy} />
            <div className="flex flex-wrap items-center gap-2">
              {dirty && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onBusy(() => updatePostBody({ data: { postId: post.id, body } }))}>
                  Save edit
                </Button>
              )}
              {['draft', 'approved', 'scheduled'].includes(post.state) && (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onBusy(() => setPostState({ data: { postId: post.id, state: 'killed' } }))}>
                    Reject
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => onBusy(() => publishNow({ data: { postId: post.id } }))}>
                    Post now
                  </Button>
                  <input
                    type="datetime-local"
                    className="h-9 rounded-md border px-2 text-sm"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !scheduleAt}
                    onClick={() =>
                      onBusy(() =>
                        setPostState({ data: { postId: post.id, state: 'scheduled', scheduledAt: new Date(scheduleAt).toISOString() } }),
                      )
                    }
                  >
                    Schedule
                  </Button>
                </>
              )}
              {post.state === 'failed' && (
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => onBusy(() => deletePost({ data: { postId: post.id } }))}>
                  Delete
                </Button>
              )}
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
