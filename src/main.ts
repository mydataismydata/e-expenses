import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './styles/clean-grids/tokens.css'
import './styles/clean-grids/tokens-dark.css'
import './styles/clean-grids/grids.css'
import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { h } from './dom'
import { homePage } from './pages/home'
import { receiptFormPage } from './pages/receiptForm'
import { reportFormPage } from './pages/reportForm'
import { reportViewPage } from './pages/reportView'
import { settingsPage } from './pages/settings'
import { notice, shell } from './pages/shell'

const app = document.getElementById('app')!

async function route(): Promise<HTMLElement> {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?')
  const q = new URLSearchParams(query)
  const seg = path.split('/').filter(Boolean)
  if (seg.length === 0) return homePage()
  if (seg[0] === 'settings') return settingsPage()
  if (seg[0] === 'report') {
    if (seg[1] === 'new') return reportFormPage()
    if (seg[2] === 'edit') return reportFormPage(seg[1])
    return reportViewPage(seg[1])
  }
  if (seg[0] === 'receipt') return receiptFormPage(seg[1] === 'new' ? undefined : seg[1], q.get('report'))
  return shell({ title: 'Not found', back: ['/', 'Reports'] }, [notice('error', 'Page not found.')])
}

let seq = 0
let lastHash = ''
async function render() {
  const mine = ++seq
  const y = window.scrollY
  const same = lastHash === location.hash
  lastHash = location.hash
  try {
    const page = await route()
    if (mine !== seq) return
    app.replaceChildren(page)
    // A refresh of the same page (rates arrived) keeps the reader's place.
    window.scrollTo(0, same ? y : 0)
  } catch (e) {
    app.replaceChildren(shell({ title: 'Error', back: ['/', 'Reports'] }, [notice('error', e instanceof Error ? e.message : String(e))]))
  }
}

addEventListener('hashchange', render)
addEventListener('app:refresh', render)
void render()

// The browser bar follows the theme: the app bar's colour, light or dark.
const meta = document.querySelector('meta[name="theme-color"]')
const syncThemeColor = () => meta?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--c-surface').trim() || '#ffffff')
new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
syncThemeColor()

// Offline support: precache the app, pick up updates when online.
const updateSW = registerSW({
  onNeedRefresh() {
    const bar = h('div', { class: 'toast update', role: 'status' }, 'A new version is available.', h('button', { class: 'btn sm', type: 'button', onclick: () => void updateSW(true) }, 'Reload'))
    document.body.append(bar)
  },
})

// Ask the browser not to evict our data under storage pressure.
void navigator.storage?.persist?.()
