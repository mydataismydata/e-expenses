import type { Located } from './mileage'

/** The drawn map's file name; a receipt with this file name carries a map the app made. */
export const MAP_FILE_NAME = 'route-map.jpg'

const W = 1200
const MAP_H = 760
const TILE = 256
const PAD = 70
const ACCENT = '#4540b8'
const INK = '#1d2433'
const MUTED = '#5b6474'
const FONT = '"IBM Plex Sans", system-ui, sans-serif'

const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z
const worldY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z
}

/** The largest zoom at which the whole route fits inside the map with a margin. */
function fitZoom(points: [number, number][]): number {
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  for (let z = 16; z > 2; z--) {
    const w = worldX(Math.max(...lngs), z) - worldX(Math.min(...lngs), z)
    const h = worldY(Math.min(...lats), z) - worldY(Math.max(...lats), z)
    if (w <= W - 2 * PAD && h <= MAP_H - 2 * PAD) return z
  }
  return 2
}

async function loadTile(z: number, x: number, y: number, fetcher: typeof fetch): Promise<ImageBitmap | null> {
  try {
    const res = await fetcher(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`)
    return res.ok ? await createImageBitmap(await res.blob()) : null
  } catch {
    return null
  }
}

function marker(ctx: CanvasRenderingContext2D, x: number, y: number, letter: string, r = 17) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = ACCENT
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${Math.round(r * 1.1)}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter, x, y + 1)
  ctx.textAlign = 'left'
}

/** Cuts text to fit a width, ending in "…". */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/**
 * The route drawn on an OpenStreetMap map, with the stops and the road distance under it, as a JPEG.
 * It is the receipt for a mileage line.
 */
export async function drawRouteMap(route: { line: [number, number][]; stops: Located[]; miles: number; km: number }, fetcher: typeof fetch = fetch): Promise<Blob> {
  await Promise.all([document.fonts.load(`600 30px ${FONT}`), document.fonts.load(`400 24px ${FONT}`), document.fonts.load(`700 19px ${FONT}`)]).catch(() => {})
  const points: [number, number][] = [...route.line, ...route.stops.map((s): [number, number] => [s.lng, s.lat])]
  const z = fitZoom(points)
  const xs = points.map((p) => worldX(p[0], z))
  const ys = points.map((p) => worldY(p[1], z))
  const left = (Math.min(...xs) + Math.max(...xs)) / 2 - W / 2
  const top = (Math.min(...ys) + Math.max(...ys)) / 2 - MAP_H / 2

  const LINE = 44
  const footer = 40 + 46 + route.stops.length * LINE + 50
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = MAP_H + footer
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f2efe9'
  ctx.fillRect(0, 0, W, MAP_H)

  // Map tiles
  const n = 2 ** z
  const jobs: Promise<void>[] = []
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + MAP_H - 1) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W - 1) / TILE); tx++) {
      const dx = tx * TILE - left
      const dy = ty * TILE - top
      jobs.push(
        loadTile(z, ((tx % n) + n) % n, ty, fetcher).then((img) => {
          if (!img) return
          ctx.drawImage(img, dx, dy)
          img.close()
        }),
      )
    }
  }
  await Promise.all(jobs)

  // The road, with a white edge so it stands out from the map
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const [width, colour] of [[11, '#ffffff'], [6, ACCENT]] as const) {
    ctx.beginPath()
    route.line.forEach(([lng, lat], i) => (i ? ctx.lineTo(worldX(lng, z) - left, worldY(lat, z) - top) : ctx.moveTo(worldX(lng, z) - left, worldY(lat, z) - top)))
    ctx.lineWidth = width
    ctx.strokeStyle = colour
    ctx.stroke()
  }
  const letter = (i: number) => String.fromCharCode(65 + i)
  route.stops.forEach((s, i) => marker(ctx, worldX(s.lng, z) - left, worldY(s.lat, z) - top, letter(i)))

  // Distance and stops
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, MAP_H, W, footer)
  ctx.fillStyle = '#d5dae3'
  ctx.fillRect(0, MAP_H, W, 2)
  let y = MAP_H + 40 + 23
  ctx.fillStyle = INK
  ctx.font = `600 30px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.fillText(`Driving distance: ${route.miles.toLocaleString('en-US')} mi (${route.km.toLocaleString('en-US')} km)`, 40, y)
  y += 46
  route.stops.forEach((s, i) => {
    marker(ctx, 57, y, letter(i), 15)
    ctx.fillStyle = INK
    ctx.font = `400 24px ${FONT}`
    ctx.textBaseline = 'middle'
    ctx.fillText(fit(ctx, s.label, W - 130), 90, y)
    y += LINE
  })
  ctx.fillStyle = MUTED
  ctx.font = `400 18px ${FONT}`
  ctx.fillText('Route by OSRM (project-osrm.org). Map data © OpenStreetMap contributors.', 40, y + 6)

  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the map.'))), 'image/jpeg', 0.9))
}
