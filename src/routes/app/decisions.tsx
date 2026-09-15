import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { listDecisionLogs } from '../../server/dashboard'
import { Card, CardContent } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'

export const Route = createFileRoute('/app/decisions')({ component: Decisions })

const PAGE_SIZE = 50

function Decisions() {
  const [logs, setLogs] = useState<any[] | null>(null)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  function refresh() {
    setError('')
    listDecisionLogs({ data: { offset: 0, limit: PAGE_SIZE } })
      .then((rows) => {
        setLogs(rows)
        setHasMore(rows.length === PAGE_SIZE)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the audit trail.'))
  }
  useEffect(() => {
    refresh()
  }, [])

  async function loadMore() {
    if (!logs) return
    setLoadingMore(true)
    try {
      const more = await listDecisionLogs({ data: { offset: logs.length, limit: PAGE_SIZE } })
      setLogs([...logs, ...more])
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
        <Button variant="outline" className="w-fit" onClick={refresh}>
          Retry
        </Button>
      </div>
    )
  }
  if (!logs) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit trail</h1>
        <p className="text-sm text-muted-foreground">Every check, draft, rejection and release, with the reason behind it.</p>
      </div>
      <Card>
        <CardContent className="grid gap-4 p-4">
          {logs.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
          {logs.map((log) => (
            <div key={log.id} className="grid gap-1 border-b pb-4 last:border-0 last:pb-0">
              <div className="flex items-center gap-2">
                <time className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</time>
                <Badge variant="outline">{log.stage}</Badge>
                {log.level !== 'info' && <Badge variant={log.level === 'error' ? 'destructive' : 'secondary'}>{log.level}</Badge>}
              </div>
              <strong className="text-sm">{log.decision}</strong>
              <p className="text-sm text-muted-foreground">{log.rationale}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      {hasMore && (
        <Button variant="outline" className="w-fit" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? 'Loading...' : 'Load more'}
        </Button>
      )}
    </div>
  )
}
