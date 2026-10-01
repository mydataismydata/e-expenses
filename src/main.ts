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
  return shell('Not found', '/', [notice('error', 'Page not found.')])
}

let seq = 0
async function render() {
  const mine = ++seq
  try {
    const page = await route()
    if (mine !== seq) return
    app.replaceChildren(page)
    window.scrollTo(0, 0)
  } catch (e) {
    app.replaceChildren(shell('Error', '/', [notice('error', e instanceof Error ? e.message : String(e))]))
  }
}

addEventListener('hashchange', render)
void render()

// Offline support: precache the app, pick up updates when online.
const updateSW = registerSW({
  onNeedRefresh() {
    const bar = h('div', { class: 'update' }, 'A new version is available. ', h('button', { class: 'btn', onclick: () => void updateSW(true) }, 'Reload'))
    document.body.append(bar)
  },
})

// Ask the browser not to evict our data under storage pressure.
void navigator.storage?.persist?.()
