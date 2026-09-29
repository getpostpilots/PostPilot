import { useEffect, useState } from 'react'
import { previewCarousel } from '../server/carousel-preview'
import { Button } from './ui/button'

// Preview of a document (carousel) post: a "Preview slides" button that renders
// the real PDF (same renderer as publishing, lib/carousel.ts) into an iframe,
// plus the slide text underneath.
export function CarouselPreview({ post }: { post: any }) {
  const doc = post.document_slides as { slides?: Array<{ heading: string; body: string }>; cta?: string } | null
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Free the blob URL when the preview closes or the row unmounts.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  if (!doc?.slides?.length) return null

  async function load() {
    setBusy(true)
    setError('')
    try {
      const { pdfBase64 } = await previewCarousel({ data: { postId: post.id } })
      const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
      setUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render the preview.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">Carousel ({doc.slides!.length + 2} slides): {post.document_title}</p>
        {url ? (
          <Button size="sm" variant="outline" onClick={() => setUrl(null)}>Hide preview</Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={load}>{busy ? 'Rendering...' : 'Preview slides'}</Button>
        )}
        {url && <a className="text-xs underline" href={url} target="_blank" rel="noreferrer">Open full size</a>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {url && <iframe src={url} title="Carousel preview" className="h-[640px] w-full max-w-[520px] rounded border" />}
      <ol className="grid list-decimal gap-1 pl-5 text-muted-foreground">
        {doc.slides!.map((s, i) => (
          <li key={i}><b className="text-foreground">{s.heading}</b>{s.body ? ` - ${s.body}` : ''}</li>
        ))}
      </ol>
      {doc.cta && <p className="text-muted-foreground">Last slide: {doc.cta}</p>}
    </div>
  )
}
