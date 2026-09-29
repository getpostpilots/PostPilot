// Text preview of a document (carousel) post's slides. The PDF itself is
// rendered from these at publish time (lib/carousel.ts).
export function CarouselPreview({ post }: { post: any }) {
  const doc = post.document_slides as { slides?: Array<{ heading: string; body: string }>; cta?: string } | null
  if (!doc?.slides?.length) return null
  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm">
      <p className="font-medium">Carousel ({doc.slides.length + 2} slides): {post.document_title}</p>
      <ol className="grid list-decimal gap-1 pl-5 text-muted-foreground">
        {doc.slides.map((s, i) => (
          <li key={i}><b className="text-foreground">{s.heading}</b>{s.body ? ` - ${s.body}` : ''}</li>
        ))}
      </ol>
      {doc.cta && <p className="text-muted-foreground">Last slide: {doc.cta}</p>}
    </div>
  )
}
