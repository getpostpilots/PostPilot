// Groups every IANA timezone the runtime knows about (Intl.supportedValuesOf
// - no hand-maintained list to go stale) into picker-friendly buckets with a
// live "GMT-07:00 America/Los_Angeles (PDT)" style label.

const US_CANADA = new Set([
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Adak', 'America/Phoenix', 'America/Detroit',
  'America/Boise', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome',
  'America/Menominee', 'America/Toronto', 'America/Vancouver', 'America/Edmonton',
  'America/Winnipeg', 'America/Halifax', 'America/St_Johns', 'America/Regina',
  'America/Whitehorse', 'America/Yellowknife', 'America/Iqaluit', 'America/Dawson',
  'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Cambridge_Bay', 'America/Inuvik',
  'America/Moncton', 'America/Glace_Bay', 'America/Goose_Bay', 'America/Blanc-Sablon',
  'America/Thunder_Bay', 'America/Nipigon', 'America/Rainy_River', 'America/Atikokan',
  'America/Creston', 'America/Swift_Current',
  'America/Indiana/Indianapolis', 'America/Indiana/Knox', 'America/Indiana/Marengo',
  'America/Indiana/Petersburg', 'America/Indiana/Tell_City', 'America/Indiana/Vevay',
  'America/Indiana/Vincennes', 'America/Indiana/Winamac',
  'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
  'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah',
])

export const TIMEZONE_GROUP_ORDER = ['US/Canada', 'America', 'Africa', 'Asia', 'Atlantic', 'Australia', 'UTC', 'Europe', 'Pacific'] as const

function groupFor(tz: string): (typeof TIMEZONE_GROUP_ORDER)[number] {
  if (tz === 'UTC' || tz.startsWith('Etc/') || tz.startsWith('Antarctica/')) return 'UTC'
  const area = tz.split('/')[0]
  if (area === 'America') return US_CANADA.has(tz) ? 'US/Canada' : 'America'
  if (area === 'Indian') return 'Asia'
  if ((TIMEZONE_GROUP_ORDER as readonly string[]).includes(area)) return area as (typeof TIMEZONE_GROUP_ORDER)[number]
  return 'UTC'
}

function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at)
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = /GMT([+-]\d{2}):(\d{2})/.exec(raw)
  if (!m) return 0
  return Number(m[1]) * 60 + Math.sign(Number(m[1]) || 1) * Number(m[2])
}

function offsetLabel(tz: string, at: Date): string {
  const raw = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  return raw === 'GMT' ? 'GMT+00:00' : raw
}

function abbrFor(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? offsetLabel(tz, at)
}

export type TimezoneOption = { id: string; label: string; group: (typeof TIMEZONE_GROUP_ORDER)[number] }

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// How many days from "today" (in tz) the next matching day-of-week is - 0 if
// today still qualifies, 1-7 otherwise, null if no days are selected at all.
// Walking forward by day-of-week index avoids calendar-date/DST arithmetic.
function nextRunOffsetDays(tz: string, daysOfWeek: number[], postTime: string, lastRunDate: string | null): number | null {
  if (daysOfWeek.length === 0) return null
  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const nowTime = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  const todayDow = WEEKDAY_LABELS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now))

  if (lastRunDate !== today && daysOfWeek.includes(todayDow) && nowTime < postTime) return 0
  for (let i = 1; i <= 7; i++) {
    if (daysOfWeek.includes((todayDow + i) % 7)) return i
  }
  return null
}

// Human-readable next-run estimate for a campaign card - "Today at 17:00",
// "Tomorrow at 17:00", or the next matching weekday.
export function describeNextRun(tz: string, daysOfWeek: number[], postTime: string, lastRunDate: string | null): string {
  const offset = nextRunOffsetDays(tz, daysOfWeek, postTime, lastRunDate)
  if (offset === null) return 'Not scheduled - no days selected'
  if (offset === 0) return `Today at ${postTime}`
  if (offset === 1) return `Tomorrow at ${postTime}`
  const todayDow = WEEKDAY_LABELS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date()))
  return `${WEEKDAY_LABELS[(todayDow + offset) % 7]} at ${postTime}`
}

// Roughly how many minutes from now the campaign's next run is - accurate
// to the minute, good enough to interleave campaign projections with real
// scheduled_at timestamps (also converted to minutes-from-now) in one list.
export function nextRunMinutesFromNow(tz: string, daysOfWeek: number[], postTime: string, lastRunDate: string | null): number | null {
  const offset = nextRunOffsetDays(tz, daysOfWeek, postTime, lastRunDate)
  if (offset === null) return null
  const nowTime = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  const [nowH, nowM] = nowTime.split(':').map(Number)
  const [postH, postM] = postTime.split(':').map(Number)
  return offset * 1440 + (postH * 60 + postM) - (nowH * 60 + nowM)
}

// Converts a wall-clock date+time in a given IANA timezone to the real UTC
// instant (DST-aware) - e.g. a campaign's post_time "17:00" in
// "America/Los_Angeles" on a given date. Standard trick: treat the wall-clock
// numbers as if they were UTC, read the zone's offset at that instant, then
// shift by it.
export function zonedTimeToUtcIso(tz: string, dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, min] = timeStr.split(':').map(Number)
  const naiveUtc = Date.UTC(y, m - 1, d, h, min)
  const offset = offsetMinutes(tz, new Date(naiveUtc))
  return new Date(naiveUtc - offset * 60000).toISOString()
}

export function buildTimezoneOptions(): TimezoneOption[] {
  const now = new Date()
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']
  return zones
    .map((tz) => ({ id: tz, label: `${offsetLabel(tz, now)} ${tz} (${abbrFor(tz, now)})`, group: groupFor(tz), minutes: offsetMinutes(tz, now) }))
    .sort((a, b) => a.minutes - b.minutes)
    .map(({ id, label, group }) => ({ id, label, group }))
}
