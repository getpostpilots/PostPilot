import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getDashboard } from '../../server/dashboard'
import { createPost } from '../../server/posts'
import { generateForPillar } from '../../server/generation'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'

export const Route = createFileRoute('/app/new-post')({ component: NewPost })

function NewPost() {
  const [account, setAccount] = useState<any>(null)
  const [draft, setDraft] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function refresh() {
    try {
      const data = await getDashboard()
      setAccount(data.accounts[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.')
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  if (!account && error) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="w-fit" onClick={() => { setError(''); refresh() }}>Retry</Button>
      </div>
    )
  }
  if (!account) return <p className="text-sm text-muted-foreground">Loading...</p>

  const pillars = account.content_pillars?.filter((p: any) => p.active) ?? []

  async function run(id: string, fn: () => Promise<unknown>, successMsg: string) {
    setBusyId(id)
    setError('')
    setMessage('')
    try {
      await fn()
      setMessage(successMsg)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusyId(null)
    }
  }

  async function generate(pillarId: string, pillarName: string) {
    await run(pillarId, () => generateForPillar({ data: { accountId: account.id, pillarId } }), `Generated a "${pillarName}" draft - review it in Scheduled Posts.`)
  }

  async function addDraft() {
    if (!draft.trim()) return
    await run('compose', () => createPost({ data: { accountId: account.id, pillarId: null, body: draft, scheduledAt: null } }), 'Added to Scheduled Posts.')
    setDraft('')
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">New post</h1>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Generate from a pillar</CardTitle>
        </CardHeader>
        {pillars.length === 0 ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No content pillars yet.{' '}
              <Link to="/app/setup" className="underline underline-offset-4">
                Add one in Configuration
              </Link>{' '}
              to generate on-topic drafts here.
            </p>
          </CardContent>
        ) : (
          <CardContent className="flex flex-wrap gap-2">
            {pillars.map((p: any) => (
              <Button key={p.id} variant="outline" size="sm" disabled={busyId !== null} onClick={() => generate(p.id, p.name)}>
                {busyId === p.id ? 'Writing...' : `Generate ${p.name}`}
              </Button>
            ))}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Write your own</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write in your own voice..." rows={4} />
          <Button className="w-fit" disabled={busyId !== null || !draft.trim()} onClick={addDraft}>
            Add to queue
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
