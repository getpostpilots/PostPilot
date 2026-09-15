import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getDashboard } from '../../server/dashboard'
import { postHeading, postSource } from '../../lib/post-display'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'

export const Route = createFileRoute('/app/published')({ component: Published })

function Published() {
  const [posts, setPosts] = useState<any[] | null>(null)
  const [error, setError] = useState('')

  function refresh() {
    setError('')
    getDashboard()
      .then((d) => setPosts(d.posts.filter((p: any) => p.state === 'published')))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load published posts.'))
  }
  useEffect(() => {
    refresh()
  }, [])

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

      <div className="grid gap-2">
        {posts.length === 0 && <p className="text-sm text-muted-foreground">Nothing published yet.</p>}
        {posts.map((post) => (
          <PublishedRow key={post.id} post={post} />
        ))}
      </div>
    </div>
  )
}

function PublishedRow({ post }: { post: any }) {
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
                {postSource(post)} - {post.published_at ? new Date(post.published_at).toLocaleString() : ''}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="grid gap-3 border-t p-4">
            {post.image_data_url && <img src={post.image_data_url} alt="" className="max-h-96 w-fit rounded-md border object-cover" />}
            <p className="whitespace-pre-wrap text-sm">{post.body}</p>
            {post.linkedin_post_urn && <p className="text-xs text-muted-foreground">LinkedIn URN: {post.linkedin_post_urn}</p>}
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
