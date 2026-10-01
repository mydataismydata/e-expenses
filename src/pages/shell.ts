import { h } from '../dom'

export const go = (path: string) => {
  location.hash = path
}

/** Page frame with a title bar and optional back link. */
export function shell(title: string, back: string | null, body: Node[], actions: Node[] = []): HTMLElement {
  return h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'bar' },
      back ? h('a', { class: 'back', href: `#${back}`, 'aria-label': 'Back' }, '‹') : null,
      h('h1', null, title),
      h('div', { class: 'bar-actions' }, ...actions),
    ),
    h('main', null, ...body),
  )
}

export const field = (label: string, input: Node, hint?: string | Node) =>
  h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('small', { class: 'hint' }, hint) : null)

export const notice = (kind: 'info' | 'warn' | 'error', text: string) => h('div', { class: `notice ${kind}` }, text)
