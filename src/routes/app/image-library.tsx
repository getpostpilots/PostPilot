import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { listLibraryImages, addLibraryImageByUrl, recordLibraryUpload, deleteLibraryImage } from '../../server/image-library'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card, CardContent } from '../../components/ui/card'

export const Route = createFileRoute('/app/image-library')({ component: ImageLibrary })

type LibraryImage = { id: string; displayUrl: string; createdAt: string }

function ImageLibrary() {
  const [images, setImages] = useState<LibraryImage[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')

  function refresh() {
    setError('')
    listLibraryImages()
      .then(setImages)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the image library.'))
  }
  useEffect(() => {
    refresh()
  }, [])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    setError('')
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop() || 'png'
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('image-library').upload(path, file)
        if (uploadErr) throw new Error(uploadErr.message)
        await recordLibraryUpload({ data: { storagePath: path } })
      }
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function addByUrl() {
    if (!url.trim()) return
    setBusy(true)
    setError('')
    try {
      await addLibraryImageByUrl({ data: { url: url.trim() } })
      setUrl('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add image.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(imageId: string) {
    setBusy(true)
    setError('')
    try {
      await deleteLibraryImage({ data: { imageId } })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete image.')
    } finally {
      setBusy(false)
    }
  }

  if (!images) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Image library</h1>
        <p className="text-sm text-muted-foreground">
          Upload images or add them by URL - reuse the same set across any campaign as style/mood reference for AI image generation.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={(e) => handleFiles(e.target.files)} className="w-fit" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." disabled={busy} className="max-w-xs" />
            <Button size="sm" disabled={busy || !url.trim()} onClick={addByUrl}>
              Add URL
            </Button>
          </div>
        </CardContent>
      </Card>

      {images.length === 0 && <p className="text-sm text-muted-foreground">No images yet.</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {images.map((img) => (
          <div key={img.id} className="group relative aspect-square overflow-hidden rounded-md border">
            <img src={img.displayUrl} alt="" className="h-full w-full object-cover" />
            <Button
              size="icon-xs"
              variant="destructive"
              disabled={busy}
              onClick={() => remove(img.id)}
              className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100"
            >
              ×
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
