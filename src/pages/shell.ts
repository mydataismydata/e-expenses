import { h } from '../dom'

export const go = (path: string) => {
  location.hash = path
}

/** Re-render the current page in place, e.g. once exchange rates have arrived. */
export const refresh = () => dispatchEvent(new Event('app:refresh'))

interface Frame {
  title: string
  /** One line under the title. */
  sub?: string
  /** [path, label] of the page one level up. */
  back?: [string, string]
  /** Buttons beside the title. */
  actions?: Node[]
}

/** Page frame: the app bar, then a title with an optional back link and actions. */
export function shell(frame: Frame, body: Node[]): HTMLElement {
  return h(
    'div',
    null,
    h(
      'header',
      { class: 'appbar' },
      h(
        'div',
        { class: 'appbar-top' },
        h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-name' }, 'Expense reports')),
        h('div', { class: 'appbar-actions' }, h('a', { class: 'kicker', href: '#/settings', 'aria-current': location.hash === '#/settings' ? 'page' : null }, 'Settings')),
      ),
    ),
    h(
      'main',
      { class: 'page' },
      frame.back ? h('a', { class: 'kicker accent back', href: `#${frame.back[0]}` }, `← ${frame.back[1]}`) : null,
      h(
        'div',
        { class: 'page-head' },
        h('div', null, h('h1', null, frame.title), frame.sub ? h('p', null, frame.sub) : null),
        frame.actions?.length ? h('div', { class: 'row' }, ...frame.actions) : null,
      ),
      h('div', { class: 'stack' }, ...body),
    ),
  )
}

/** A card with a heading row and a body. `head` holds small actions at the right of the heading. */
export const card = (title: string, body: Node[], head: Node[] = []) =>
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, title), head.length ? h('div', { class: 'row' }, ...head) : null), h('div', { class: 'card-body stack' }, ...body))

export const field = (label: string, input: Node, hint?: string | Node) =>
  h('label', { class: 'field' }, h('span', { class: 'kicker' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null)

const NOTICE_CLASS = { info: 'notice info', warn: 'notice', error: 'notice bad', ok: 'notice ok' }
export const notice = (kind: keyof typeof NOTICE_CLASS, text: string) => h('div', { class: NOTICE_CLASS[kind], role: kind === 'error' ? 'alert' : null }, text)

/**
 * Ask before something that cannot be undone, inside the page: `host` shows the question
 * with a confirm and a cancel button until one is pressed. Some browsers (embedded views,
 * previews) silently block window.confirm(), which made delete buttons do nothing.
 */
export function askFirst(host: HTMLElement, question: string, yesLabel: string, action: () => Promise<void>) {
  const before = [...host.childNodes]
  const opener = document.activeElement as HTMLElement | null
  const restore = () => {
    host.replaceChildren(...before)
    opener?.focus()
  }
  const text = h('p', { role: 'alert' }, question)
  const yes = h(
    'button',
    {
      class: 'btn danger',
      type: 'button',
      onclick: async () => {
        yes.disabled = no.disabled = true
        try {
          await action()
        } catch (e) {
          text.textContent = `That did not work. ${e instanceof Error ? e.message : e}`
          yes.disabled = no.disabled = false
        }
      },
    },
    yesLabel,
  )
  const no = h('button', { class: 'btn quiet', type: 'button', onclick: restore }, 'Cancel')
  const box = h('div', { class: 'notice bad stack tight confirm-ask', role: 'group', 'aria-label': 'Confirm', onkeydown: (e: KeyboardEvent) => e.key === 'Escape' && restore() }, text, h('div', { class: 'row' }, yes, no))
  host.replaceChildren(box)
  yes.focus()
}

export const input = (props: Record<string, unknown>) => h('input', { class: 'input', ...props })
export const select = (props: Record<string, unknown>, ...options: Node[]) => h('select', { class: 'select', ...props }, ...options)
