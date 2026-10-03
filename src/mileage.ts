/** Mileage allowances: the IRS rate, reading map links, and the road distance between stops. */

/**
 * IRS standard mileage rate for business use, in USD per mile, from the date it took effect.
 * Source: irs.gov/tax-professionals/standard-mileage-rates. Add each new rate when the IRS announces it.
 */
export const IRS_RATES: readonly [since: string, rate: number][] = [
  ['2022-01-01', 0.585],
  ['2022-07-01', 0.625],
  ['2023-01-01', 0.655],
  ['2024-01-01', 0.67],
  ['2025-01-01', 0.7],
  ['2026-01-01', 0.725],
  ['2026-07-01', 0.76],
]

export interface MileRate {
  rate: number
  /** Date the rate took effect. */
  since: string
  /** False when the date falls in a year after the newest rate in the table, or before the oldest. */
  known: boolean
}

export function irsRate(date: string): MileRate {
  let i = -1
  for (const [n, [since]] of IRS_RATES.entries()) if (since <= date) i = n
  const [since, rate] = IRS_RATES[Math.max(i, 0)]
  const lastYear = IRS_RATES[IRS_RATES.length - 1][0].slice(0, 4)
  return { rate, since, known: i >= 0 && date.slice(0, 4) <= lastYear }
}

const METERS_PER_MILE = 1609.344
/** Miles to one decimal, as the claim uses them. */
export const toMiles = (meters: number) => Math.round((meters / METERS_PER_MILE) * 10) / 10
export const mileageAmount = (miles: number, rate: number) => Math.round(miles * rate * 100) / 100

/** A start, end or stop on the way. A stop given as coordinates has an empty label. */
export interface Stop {
  label: string
  lat?: number
  lng?: number
}
export type Located = Stop & { lat: number; lng: number }

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/
function stopFrom(text: string): Stop {
  const label = text.trim()
  const m = COORD.exec(label)
  return m ? { label: '', lat: Number(m[1]), lng: Number(m[2]) } : { label }
}
const decodePart = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** Google's long directions link: /maps/dir/<start>/<end>/@view/data=…!1d<lng>!2d<lat>… */
function googlePath(url: URL): Stop[] {
  const parts = url.pathname.split('/')
  const at = parts.indexOf('dir')
  if (at < 0) throw new Error('This Google Maps link shows a place, not directions. Ask Google Maps for directions, then copy the link.')
  const segments: string[] = []
  for (const p of parts.slice(at + 1)) {
    if (p.startsWith('@') || p.includes('=')) break
    segments.push(decodePart(p))
  }
  while (segments.length && !segments[segments.length - 1]) segments.pop()
  const stops = segments.map(stopFrom)
  // The data part holds the exact point of each named stop, in order.
  const pairs = [...url.pathname.matchAll(/!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g)].map((m) => ({ lng: Number(m[1]), lat: Number(m[2]) }))
  const named = stops.filter((s) => s.label)
  if (pairs.length === named.length) named.forEach((s, i) => Object.assign(s, pairs[i]))
  else if (pairs.length === stops.length) stops.forEach((s, i) => Object.assign(s, pairs[i]))
  return stops
}

/**
 * The stops of a directions link from Google Maps (long link or ?api=1), OpenStreetMap or Apple Maps.
 * Throws a message for the user when the link cannot be read.
 */
export function parseMapLink(text: string): Stop[] {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    throw new Error('That is not a link. Paste the whole link, starting with https://.')
  }
  const host = url.hostname.replace(/^www\./, '')
  const q = url.searchParams
  let stops: Stop[]
  if (/(^|\.)goo\.gl$/.test(host) || host === 'maps.apple' || host === 'g.co')
    throw new Error('The app cannot open short links. Open the link in a browser, then copy the full link from the address bar.')
  if (q.get('route')) stops = q.get('route')!.split(';').map(stopFrom)
  else if (q.has('destination')) stops = [q.get('origin') ?? '', ...(q.get('waypoints')?.split('|') ?? []), q.get('destination')!].map(stopFrom)
  else if (q.has('daddr')) stops = [q.get('saddr') ?? '', ...q.get('daddr')!.split(' to:')].map(stopFrom)
  else if (q.has('from') && q.has('to')) stops = [q.get('from')!, q.get('to')!].map(stopFrom)
  else if (/(^|\.)google\.[a-z.]{2,}$/.test(host)) stops = googlePath(url)
  else throw new Error('The app reads directions links from Google Maps, OpenStreetMap and Apple Maps.')
  if (stops.length < 2) throw new Error('The link needs a start and an end.')
  if (stops.some((s) => !s.label && s.lat === undefined))
    throw new Error('The link starts or ends at "Your location". Pick an address for it in the map, then copy the link again.')
  return stops
}

/** "Charles de Gaulle Airport" from "Charles de Gaulle Airport, 95700 Roissy-en-France". */
export const shortLabel = (label: string) => label.split(',')[0].trim()

type Fetcher = typeof fetch
const reach = (p: Promise<Response>) => p.catch(() => Promise.reject(new Error(navigator.onLine === false ? 'Offline.' : 'Could not reach the map service.')))

/** Coordinates of an address or place name, from OpenStreetMap's place search (Nominatim). */
export async function findPlace(label: string, fetcher: Fetcher = fetch): Promise<{ lat: number; lng: number }> {
  const res = await reach(fetcher(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(label)}`))
  if (!res.ok) throw new Error('The place search did not answer. Try again in a minute.')
  const [hit] = (await res.json()) as { lat: string; lon: string }[]
  if (!hit) throw new Error(`Could not find "${label}" on the map. Type a fuller address, or paste a map link.`)
  return { lat: Number(hit.lat), lng: Number(hit.lon) }
}

/** Fills in the coordinates of stops that only have a name. The place search allows one request a second. */
export async function locateStops(stops: Stop[], fetcher: Fetcher = fetch, pause = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Located[]> {
  const out: Located[] = []
  let searched = 0
  for (const s of stops) {
    if (s.lat !== undefined && s.lng !== undefined) out.push({ ...s, lat: s.lat, lng: s.lng })
    else {
      if (searched++) await pause(1100)
      out.push({ ...s, ...(await findPlace(s.label, fetcher)) })
    }
  }
  return out
}

export interface DrivingRoute {
  meters: number
  /** The road, as [lng, lat] points. */
  line: [number, number][]
  /** Street nearest each stop, for stops given as coordinates. */
  names: string[]
}

/** Shortest driving route through the stops, from the OSRM route service on OpenStreetMap data. */
export async function drivingRoute(stops: Located[], fetcher: Fetcher = fetch): Promise<DrivingRoute> {
  const path = stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(';')
  const res = await reach(fetcher(`https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`))
  const body = (await res.json().catch(() => null)) as {
    code?: string
    routes?: { distance: number; geometry: { coordinates: [number, number][] } }[]
    waypoints?: { name?: string }[]
  } | null
  if (body?.code === 'NoRoute') throw new Error('No road joins these places.')
  const route = body?.code === 'Ok' ? body.routes?.[0] : undefined
  if (!route) throw new Error('The route service did not answer. Try again in a minute.')
  return { meters: route.distance, line: route.geometry.coordinates, names: (body!.waypoints ?? []).map((w) => w.name ?? '') }
}
