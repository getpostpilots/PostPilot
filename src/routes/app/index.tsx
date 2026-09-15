import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getDashboard } from '../../server/dashboard'
import { startLinkedIn } from '../../server/linkedin'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'

export const Route = createFileRoute('/app/')({ component: Overview })

type Dashboard = Awaited<ReturnType<typeof getDashboard>>

function Overview() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)

  async function refresh() {
    try {
      setData(await getDashboard())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the dashboard.')
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  async function connect() {
    setConnecting(true)
    try {
      const { url } = await startLinkedIn()
      window.location.assign(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start LinkedIn connect.')
      setConnecting(false)
    }
  }

  if (error) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="w-fit" onClick={() => { setError(''); refresh() }}>
          Retry
        </Button>
      </div>
    )
  }

  if (!data) return <p className="text-sm text-muted-foreground">Loading...</p>

  const account = data.accounts[0]

  if (!account) {
    return (
      <div className="grid max-w-md gap-4">
        <h1 className="text-2xl font-semibold">Connect LinkedIn to get started</h1>
        <p className="text-sm text-muted-foreground">
          PostPilot drafts posts in your voice and queues them for your approval. Nothing publishes without you.
        </p>
        <Button onClick={connect} disabled={connecting} className="w-fit">
          {connecting ? 'Opening LinkedIn...' : 'Connect LinkedIn'}
        </Button>
      </div>
    )
  }

  // Refreshing happens automatically on publish (see server/linkedin.ts's
  // getValidAccessToken) - this is just a heads-up before that ever has a
  // chance to fail (no refresh token granted, or the refresh call itself
  // errors), so it stays hidden on any account that's actually healthy.
  const tokenExpiringSoon = !account.token_expires_at || new Date(account.token_expires_at).getTime() - Date.now() < 3 * 24 * 3600 * 1000

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{account.display_name}</h1>
          <p className="text-sm text-muted-foreground">
            {account.kill_switch_engaged ? (
              <Badge variant="destructive">Publishing paused</Badge>
            ) : tokenExpiringSoon ? (
              <Badge variant="destructive">LinkedIn connection expiring - reconnect below</Badge>
            ) : (
              <Badge>Operating normally</Badge>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {tokenExpiringSoon && (
            <Button variant="outline" onClick={connect} disabled={connecting}>
              {connecting ? 'Opening LinkedIn...' : 'Reconnect LinkedIn'}
            </Button>
          )}
          <Link to="/app/scheduled">
            <Button variant="outline">Review queue</Button>
          </Link>
        </div>
      </div>

      {(account.content_pillars?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="grid gap-2 p-4">
            <p className="text-sm font-medium">Get set up before generating</p>
            <p className="text-sm text-muted-foreground">
              Add a content pillar, your AI key, and (optionally) a voice profile in{' '}
              <Link to="/app/setup" className="underline underline-offset-4">
                Configuration
              </Link>{' '}
              - then head to New post to start generating.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Published" value={data.stats.published} />
        <Metric label="Awaiting release" value={data.stats.queued} />
        <Metric label="Daily cap" value={account.daily_cap} />
        <Metric label="Weekly cap" value={account.weekly_cap} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.logs.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {data.logs.slice(0, 8).map((log) => (
            <div key={log.id} className="grid gap-0.5 border-b pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                {log.level === 'error' && <Badge variant="destructive">error</Badge>}
                {log.level === 'warn' && <Badge variant="secondary">warn</Badge>}
                {log.decision}
              </div>
              <p className="text-xs text-muted-foreground">{log.rationale}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}
