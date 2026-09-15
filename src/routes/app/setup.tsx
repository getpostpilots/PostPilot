import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getDashboard } from '../../server/dashboard'
import { getKeyStatus, killSwitch, removeApiKey, saveApiKey, saveConfig, saveFounderPov, savePillars, saveVoice } from '../../server/settings'
import { fetchBrandFromWebsite, saveBrand } from '../../server/brand'
import ThemeToggle from '../../components/ThemeToggle'
import { AI_PROVIDERS, getProvider } from '../../lib/ai-providers'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Switch } from '../../components/ui/switch'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../components/ui/select'
import { buildTimezoneOptions, TIMEZONE_GROUP_ORDER } from '../../lib/timezones'

export const Route = createFileRoute('/app/setup')({ component: Setup })

// Computed once from the runtime's own IANA data (Intl.supportedValuesOf) -
// no hand-maintained list to go stale, and guaranteed to match what the
// scheduler's Intl.DateTimeFormat calls will actually accept.
const TIMEZONE_OPTIONS = buildTimezoneOptions()

type Dashboard = Awaited<ReturnType<typeof getDashboard>>

function Setup() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [keyStatus, setKeyStatus] = useState<Awaited<ReturnType<typeof getKeyStatus>> | null>(null)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')

  async function refresh() {
    try {
      setData(await getDashboard())
      setKeyStatus(await getKeyStatus())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load configuration.')
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  if (loadError) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" className="w-fit" onClick={() => { setLoadError(''); refresh() }}>
          Retry
        </Button>
      </div>
    )
  }
  if (!data) return <p className="text-sm text-muted-foreground">Loading...</p>
  const account = data.accounts[0]
  if (!account) return <p className="text-sm text-muted-foreground">Connect LinkedIn in Overview first.</p>

  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuration</h1>
        <p className="text-sm text-muted-foreground">Voice, positioning, publishing limits, and the kill switch.</p>
      </div>
      {message && <p className={`text-sm ${message.startsWith('Failed') ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Light, dark, or match your system.</p>
          <ThemeToggle />
        </CardContent>
      </Card>

      <BrandCard account={account} onSaved={async (msg) => { setMessage(msg); await refresh() }} />
      <ApiKeyCard status={keyStatus} onSaved={async (msg) => { setMessage(msg); await refresh() }} />
      <VoiceCard accountId={account.id} voiceProfiles={account.voice_profiles ?? []} onSaved={async (msg) => { setMessage(msg); await refresh() }} />
      <PillarsCard accountId={account.id} pillars={account.content_pillars ?? []} onSaved={async (msg) => { setMessage(msg); await refresh() }} />
      <FounderPovCard accountId={account.id} beliefs={account.founder_pov ?? []} onSaved={async (msg) => { setMessage(msg); await refresh() }} />
      <PublishingCard account={account} onSaved={async (msg) => { setMessage(msg); await refresh() }} />
    </div>
  )
}

function BrandCard({ account, onSaved }: { account: any; onSaved: (m: string) => void }) {
  const [url, setUrl] = useState(account.website_url ?? '')
  const [logoUrl, setLogoUrl] = useState(account.logo_url ?? '')
  const [primaryColor, setPrimaryColor] = useState(account.brand_primary_color ?? '#2563eb')
  const [secondaryColor, setSecondaryColor] = useState(account.brand_secondary_color ?? '#1e293b')
  const [tertiaryColor, setTertiaryColor] = useState(account.brand_tertiary_color ?? '#64748b')
  const [description, setDescription] = useState(account.brand_description ?? '')
  const [scraping, setScraping] = useState(false)
  const [busy, setBusy] = useState(false)

  async function scrape() {
    if (!url.trim()) return
    setScraping(true)
    try {
      const result = await fetchBrandFromWebsite({ data: { url: url.trim() } })
      if (result.logoUrl) setLogoUrl(result.logoUrl)
      if (result.primaryColor) setPrimaryColor(result.primaryColor)
      if (result.secondaryColor) setSecondaryColor(result.secondaryColor)
      if (result.tertiaryColor) setTertiaryColor(result.tertiaryColor)
      if (result.description) setDescription(result.description)
      onSaved(
        result.logoUrl || result.description || result.primaryColor
          ? 'Pulled what we could find - review and adjust below, then save.'
          : 'Could not find a logo, color, or description on that page - fill them in manually.',
      )
    } catch (err) {
      onSaved(err instanceof Error ? `Failed to scrape site: ${err.message}` : 'Failed to scrape site.')
    } finally {
      setScraping(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      await saveBrand({ data: { accountId: account.id, websiteUrl: url, logoUrl, primaryColor, secondaryColor, tertiaryColor, description } })
      onSaved('Brand saved.')
    } catch (err) {
      onSaved(err instanceof Error ? `Failed to save brand: ${err.message}` : 'Failed to save brand.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Brand</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">Pull a logo, color palette, and description straight from your website, then adjust anything it missed.</p>
        <div className="flex gap-2">
          <Input placeholder="https://yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button size="sm" variant="outline" disabled={scraping || !url.trim()} onClick={scrape}>
            {scraping ? 'Scraping...' : 'Scrape site'}
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {logoUrl && <img src={logoUrl} alt="" className="h-12 w-12 rounded border object-contain" />}
          <Input placeholder="Logo URL" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
        </div>

        <div className="flex gap-3">
          <div className="flex items-center gap-2">
            <Label>Primary</Label>
            <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-12 rounded border" />
          </div>
          <div className="flex items-center gap-2">
            <Label>Secondary</Label>
            <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="h-9 w-12 rounded border" />
          </div>
          <div className="flex items-center gap-2">
            <Label>Tertiary</Label>
            <input type="color" value={tertiaryColor} onChange={(e) => setTertiaryColor(e.target.value)} className="h-9 w-12 rounded border" />
          </div>
        </div>

        <Textarea placeholder="What the company does, in a sentence or two" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />

        <Button size="sm" className="w-fit" disabled={busy} onClick={save}>
          Save brand
        </Button>
      </CardContent>
    </Card>
  )
}

function ApiKeyCard({ status, onSaved }: { status: Awaited<ReturnType<typeof getKeyStatus>> | null; onSaved: (m: string) => void }) {
  const [providerId, setProviderId] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const provider = getProvider(providerId)

  // The dropdown defaults to Anthropic on every mount; once we know which
  // provider is actually saved, reflect that instead of silently reverting.
  useEffect(() => {
    if (status?.configured && status.provider) setProviderId(status.provider)
  }, [status?.configured, status?.provider])

  async function save() {
    setBusy(true)
    try {
      await saveApiKey({ data: { apiKey, provider: providerId, model: model || undefined, baseUrl: baseUrl || undefined } })
      setApiKey('')
      onSaved('API key saved.')
    } catch (err) {
      onSaved(err instanceof Error ? `Failed to save key: ${err.message}` : 'Failed to save key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Your AI provider key</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {status?.configured ? `Key saved for ${status.provider}. Drafts generate on your own account.` : 'Paste a key so drafts can generate.'}
        </p>
        <Select value={providerId} onValueChange={setProviderId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {AI_PROVIDERS.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {provider.baseUrl === null && provider.transport === 'openai' && (
          <Input placeholder="https://your-endpoint/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        )}
        <Input autoComplete="off" placeholder={`Model - default ${provider.defaultModel}`} value={model} onChange={(e) => setModel(e.target.value)} />
        <Input type="password" autoComplete="new-password" placeholder={`API key - ${provider.keyHint}`} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || apiKey.length < 8} onClick={save}>Save key</Button>
          {status?.configured && (
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
              try {
                await removeApiKey()
                onSaved('Key removed.')
              } catch (err) {
                onSaved(err instanceof Error ? `Failed to remove key: ${err.message}` : 'Failed to remove key.')
              }
            }}>
              Remove key
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function VoiceCard({ accountId, voiceProfiles, onSaved }: { accountId: string; voiceProfiles: any[]; onSaved: (m: string) => void }) {
  const active = voiceProfiles.find((v) => v.active)
  const [text, setText] = useState<string>(active?.source_posts?.join('\n\n---\n\n') ?? '')
  const [busy, setBusy] = useState(false)
  const posts = text.split(/\n*---\n*/).map((p) => p.trim()).filter((p) => p.length >= 40)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Voice calibration</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">Paste posts you've actually written, separated by a line with just ---. 10+ gives the best results, but any number works.</p>
        {active && <p className="text-xs text-muted-foreground">Currently saved: {active.source_posts?.length ?? 0} post(s), version {active.version}.</p>}
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'First post...\n\n---\n\nSecond post...'} />
        <p className="text-xs text-muted-foreground">{posts.length} post{posts.length === 1 ? '' : 's'} detected{posts.length > 0 && posts.length < 10 ? ' (10+ recommended)' : ''}.</p>
        <Button
          size="sm"
          className="w-fit"
          disabled={busy || posts.length === 0}
          onClick={async () => {
            setBusy(true)
            try {
              await saveVoice({ data: { accountId, posts } })
              onSaved('Voice profile saved.')
            } catch (err) {
              onSaved(err instanceof Error ? `Failed to save voice profile: ${err.message}` : 'Failed to save voice profile.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Save voice profile
        </Button>
      </CardContent>
    </Card>
  )
}

type PillarRow = { name: string; description: string; kind: 'founder' | 'product'; targetShare: number; ctaMechanic: 'discussion' | 'comment_gate' }

function PillarsCard({ accountId, pillars, onSaved }: { accountId: string; pillars: any[]; onSaved: (m: string) => void }) {
  const [rows, setRows] = useState<PillarRow[]>(
    pillars.length
      ? pillars.map((p) => ({ name: p.name, description: p.description, kind: p.kind, targetShare: Number(p.target_share), ctaMechanic: p.cta_mechanic }))
      : [{ name: '', description: '', kind: 'founder', targetShare: 0.5, ctaMechanic: 'discussion' }],
  )
  const [busy, setBusy] = useState(false)
  const founderShare = rows.filter((r) => r.kind === 'founder').reduce((s, r) => s + (r.targetShare || 0), 0)

  function update(i: number, patch: Partial<PillarRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Content pillars</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-xs text-muted-foreground">Founder-led share: {Math.round(founderShare * 100)}% (aim for 50%+)</p>
        {rows.map((row, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-3">
            <div className="flex gap-2">
              <Input placeholder="Pillar name" value={row.name} onChange={(e) => update(i, { name: e.target.value })} />
              <Select value={row.kind} onValueChange={(v) => update(i, { kind: v as PillarRow['kind'] })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="founder">Founder-led</SelectItem>
                  <SelectItem value="product">Product</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                step={0.05}
                min={0}
                max={1}
                className="w-24"
                value={row.targetShare}
                onChange={(e) => update(i, { targetShare: Number(e.target.value) })}
              />
              <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>Remove</Button>
            </div>
            <Textarea placeholder="What this pillar argues, and who it's for" value={row.description} onChange={(e) => update(i, { description: e.target.value })} />
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((rs) => [...rs, { name: '', description: '', kind: 'founder', targetShare: 0, ctaMechanic: 'discussion' }])}
          >
            Add pillar
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await savePillars({ data: { accountId, pillars: rows.filter((r) => r.name.trim()) } })
                onSaved('Pillars saved.')
              } catch (err) {
                onSaved(err instanceof Error ? `Failed to save pillars: ${err.message}` : 'Failed to save pillars.')
              } finally {
                setBusy(false)
              }
            }}
          >
            Save pillars
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function FounderPovCard({ accountId, beliefs, onSaved }: { accountId: string; beliefs: any[]; onSaved: (m: string) => void }) {
  const [text, setText] = useState(
    beliefs.map((b) => [b.label, b.belief, b.challenges ?? '', b.evidence ?? ''].join(' | ')).join('\n'),
  )
  const [busy, setBusy] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Founder point of view</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">One per line: label | belief | what it argues against | evidence (last two optional).</p>
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        <Button
          size="sm"
          className="w-fit"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const rows = text
                .split('\n')
                .filter((l) => l.trim())
                .map((line) => {
                  const parts = line.split('|').map((s) => s.trim())
                  return {
                    label: parts.at(0) ?? '',
                    belief: parts.at(1) ?? '',
                    challenges: parts.at(2) || undefined,
                    evidence: parts.at(3) || undefined,
                  }
                })
                .filter((b) => b.label && b.belief)
              await saveFounderPov({ data: { accountId, beliefs: rows } })
              onSaved('Founder POV saved.')
            } catch (err) {
              onSaved(err instanceof Error ? `Failed to save founder POV: ${err.message}` : 'Failed to save founder POV.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Save point of view
        </Button>
      </CardContent>
    </Card>
  )
}

function PublishingCard({ account, onSaved }: { account: any; onSaved: (m: string) => void }) {
  const [timezone, setTimezone] = useState(account.timezone)
  const [dailyCap, setDailyCap] = useState(account.daily_cap)
  const [weeklyCap, setWeeklyCap] = useState(account.weekly_cap)
  const [minGap, setMinGap] = useState(account.min_gap_minutes)
  const [primaryAudience, setPrimaryAudience] = useState(account.primary_audience ?? '')
  const [secondaryAudience, setSecondaryAudience] = useState(account.secondary_audience ?? '')
  const [busy, setBusy] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Audience and publishing limits</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Label>Primary audience</Label>
        <Input value={primaryAudience} onChange={(e) => setPrimaryAudience(e.target.value)} />
        <Label>Secondary audience</Label>
        <Input value={secondaryAudience} onChange={(e) => setSecondaryAudience(e.target.value)} />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Daily cap</Label>
            <Input type="number" value={dailyCap} onChange={(e) => setDailyCap(Number(e.target.value))} />
          </div>
          <div>
            <Label>Weekly cap</Label>
            <Input type="number" value={weeklyCap} onChange={(e) => setWeeklyCap(Number(e.target.value))} />
          </div>
          <div>
            <Label>Min gap (min)</Label>
            <Input type="number" value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} />
          </div>
        </div>
        <Label>Timezone</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {TIMEZONE_GROUP_ORDER.map((group) => {
              const options = TIMEZONE_OPTIONS.filter((o) => o.group === group)
              if (options.length === 0) return null
              return (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                  ))}
                </SelectGroup>
              )
            })}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="w-fit"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await saveConfig({
                data: { accountId: account.id, timezone, dailyCap, weeklyCap, minGapMinutes: minGap, primaryAudience, secondaryAudience },
              })
              onSaved('Publishing settings saved.')
            } catch (err) {
              onSaved(err instanceof Error ? `Failed to save: ${err.message}` : 'Failed to save.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Save
        </Button>

        <div className="mt-4 flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Kill switch</p>
            <p className="text-xs text-muted-foreground">Pauses every outbound publish immediately.</p>
          </div>
          <Switch
            checked={account.kill_switch_engaged}
            onCheckedChange={async (checked) => {
              try {
                await killSwitch({ data: { accountId: account.id, engaged: checked } })
                onSaved(checked ? 'Publishing paused.' : 'Publishing resumed.')
              } catch (err) {
                onSaved(err instanceof Error ? `Failed to update kill switch: ${err.message}` : 'Failed to update kill switch.')
              }
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
