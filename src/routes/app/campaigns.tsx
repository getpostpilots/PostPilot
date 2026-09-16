import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { createCampaign, deleteCampaign, getCampaignsPageData, postCampaignNowFn, setCampaignStatus, updateCampaign } from '../../server/campaigns'
import { listLibraryImages } from '../../server/image-library'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import { describeNextRun } from '../../lib/timezones'

export const Route = createFileRoute('/app/campaigns')({ component: Campaigns })

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type LibraryImage = { id: string; displayUrl: string }

type CampaignFormValues = {
  name: string
  durationType: 'week' | 'month' | 'evergreen'
  days: number[]
  postTime: string
  topics: string
  imageIds: string[]
}

function Campaigns() {
  const [accountId, setAccountId] = useState<string | null>(null)
  const [timezone, setTimezone] = useState('UTC')
  const [campaigns, setCampaigns] = useState<any[] | null>(null)
  const [library, setLibrary] = useState<LibraryImage[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showForm, setShowForm] = useState(false)

  async function refresh() {
    try {
      const data = await getCampaignsPageData()
      if (!data.account) return
      setAccountId(data.account.id)
      setTimezone(data.account.timezone || 'UTC')
      setCampaigns(data.campaigns)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns.')
    }
  }
  useEffect(() => {
    refresh()
    listLibraryImages().then(setLibrary).catch(() => {})
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

  if (error && !campaigns) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="w-fit" onClick={refresh}>Retry</Button>
      </div>
    )
  }
  if (!accountId || !campaigns) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Recurring topic cycles that auto-generate and post on their own schedule.</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : 'New campaign'}</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-sm">New campaign</CardTitle></CardHeader>
          <CardContent>
            <CampaignForm
              submitLabel="Create campaign"
              library={library}
              onSubmit={async (values) => {
                await createCampaign({
                  data: {
                    accountId,
                    name: values.name,
                    durationType: values.durationType,
                    daysOfWeek: values.days,
                    postTime: values.postTime,
                    topics: values.topics.split('\n'),
                    imageIds: values.imageIds,
                  },
                })
                setShowForm(false)
                await refresh()
              }}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {campaigns.length === 0 && <p className="text-sm text-muted-foreground">No campaigns yet.</p>}
        {campaigns.map((c) => (
          <CampaignRow key={c.id} campaign={c} timezone={timezone} library={library} busy={busyId === c.id} onBusy={(fn) => run(c.id, fn)} onSaved={refresh} />
        ))}
      </div>
    </div>
  )
}

function CampaignRow({
  campaign,
  timezone,
  library,
  busy,
  onBusy,
  onSaved,
}: {
  campaign: any
  timezone: string
  library: LibraryImage[]
  busy: boolean
  onBusy: (fn: () => Promise<unknown>) => void
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const topics = campaign.campaign_topics ?? []
  const images = campaign.campaign_library_images ?? []
  const nextTopic = topics.length ? topics[campaign.next_topic_index % topics.length]?.topic : null
  // next_topic_index already points at the *next* one, so the topic behind
  // it is whichever one the last run actually used.
  const lastTopic = campaign.last_run_date && topics.length ? topics[(campaign.next_topic_index - 1 + topics.length) % topics.length]?.topic : null
  const days = (campaign.days_of_week as number[]).slice().sort().map((d) => DAYS[d]).join(', ')
  const nextRun = campaign.status === 'active' ? describeNextRun(timezone, campaign.days_of_week, campaign.post_time, campaign.last_run_date) : null

  if (editing) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Edit campaign</CardTitle></CardHeader>
        <CardContent>
          <CampaignForm
            submitLabel="Save changes"
            library={library}
            initial={{
              name: campaign.name,
              durationType: campaign.duration_type,
              days: campaign.days_of_week,
              postTime: campaign.post_time,
              topics: topics.map((t: any) => t.topic).join('\n'),
              imageIds: images.map((i: any) => i.image_library_id),
            }}
            onSubmit={async (values) => {
              await updateCampaign({
                data: {
                  campaignId: campaign.id,
                  name: values.name,
                  durationType: values.durationType,
                  daysOfWeek: values.days,
                  postTime: values.postTime,
                  topics: values.topics.split('\n'),
                  imageIds: values.imageIds,
                },
              })
              setEditing(false)
              await onSaved()
            }}
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="grid gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm">{campaign.name}</strong>
          <Badge variant={campaign.status === 'active' ? 'default' : campaign.status === 'paused' ? 'secondary' : 'outline'}>{campaign.status}</Badge>
          <Badge variant="outline">{campaign.duration_type}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {days} at {campaign.post_time} ({topics.length} topic{topics.length === 1 ? '' : 's'}, {images.length} inspiration image{images.length === 1 ? '' : 's'})
          {campaign.end_date && ` - ends ${campaign.end_date}`}
        </p>
        {nextTopic && <p className="text-xs text-muted-foreground">Next up: {nextTopic}</p>}
        {campaign.status === 'completed' && <p className="text-xs text-muted-foreground">Finished - edit it to restart from today.</p>}
        {(campaign.last_run_at || campaign.last_run_date) && (
          <p className="text-xs text-muted-foreground">
            Last ran: {campaign.last_run_at ? new Date(campaign.last_run_at).toLocaleString() : `${campaign.last_run_date} (time unavailable - predates tracking that)`}
            {lastTopic && ` - ${lastTopic}`}
          </p>
        )}
        {nextRun && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Next run: {nextRun}</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onBusy(() => postCampaignNowFn({ data: { campaignId: campaign.id } }))}>
              Post now
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
          {campaign.status === 'active' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onBusy(() => setCampaignStatus({ data: { campaignId: campaign.id, status: 'paused' } }))}>
              Pause
            </Button>
          )}
          {campaign.status === 'paused' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onBusy(() => setCampaignStatus({ data: { campaignId: campaign.id, status: 'active' } }))}>
              Resume
            </Button>
          )}
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => onBusy(() => deleteCampaign({ data: { campaignId: campaign.id } }))}>
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function CampaignForm({
  initial,
  submitLabel,
  library,
  onSubmit,
  onCancel,
}: {
  initial?: CampaignFormValues
  submitLabel: string
  library: LibraryImage[]
  onSubmit: (values: CampaignFormValues) => Promise<void>
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [durationType, setDurationType] = useState<'week' | 'month' | 'evergreen'>(initial?.durationType ?? 'evergreen')
  const [days, setDays] = useState<number[]>(initial?.days ?? [1, 2, 3, 4, 5])
  const [postTime, setPostTime] = useState(initial?.postTime ?? '17:00')
  const [topics, setTopics] = useState(initial?.topics ?? '')
  const [imageIds, setImageIds] = useState<string[]>(initial?.imageIds ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggleDay(d: number) {
    setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()))
  }

  function toggleImage(id: string) {
    setImageIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await onSubmit({ name, durationType, days, postTime, topics, imageIds })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save campaign.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Label>Name</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New feature launch" />

      <Label>Duration</Label>
      <Select value={durationType} onValueChange={(v) => setDurationType(v as typeof durationType)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="week">One week</SelectItem>
          <SelectItem value="month">One month</SelectItem>
          <SelectItem value="evergreen">Never-ending</SelectItem>
        </SelectContent>
      </Select>

      <Label>Days</Label>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => toggleDay(i)}
            className={`rounded-full border px-3 py-1 text-xs ${days.includes(i) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <Label>Post time (account timezone)</Label>
      <Input type="time" value={postTime} onChange={(e) => setPostTime(e.target.value)} className="w-fit" />

      <Label>Topics - one per line, cycled in order, never repeated back to back</Label>
      <Textarea rows={5} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={'Announcing the new AI qualification feature\nCustomer story: agency doubled booked calls\nBehind the scenes: how the AI decides B2B vs B2C'} />

      <Label>Inspiration images (optional) - style reference from your image library, never reproduced as-is</Label>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-fit">
            Choose images ({imageIds.length} selected)
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose inspiration images</DialogTitle>
          </DialogHeader>
          {library.length === 0 ? (
            <p className="text-sm text-muted-foreground">No images in your library yet - add some from the Image library page.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {library.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => toggleImage(img.id)}
                  className={`aspect-square overflow-hidden rounded-md border-2 ${imageIds.includes(img.id) ? 'border-primary' : 'border-transparent'}`}
                >
                  <img src={img.displayUrl} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex gap-2">
        <Button size="sm" className="w-fit" disabled={busy || !name.trim() || !topics.trim()} onClick={submit}>
          {busy ? 'Saving...' : submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="outline" className="w-fit" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
