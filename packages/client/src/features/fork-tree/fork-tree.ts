import { SESSION_ROW_KEY_ATTRIBUTE } from '@dsh-claude-ui/contracts/dom'
import { observeMatches } from '@dsh-claude-ui/engine/bus'
import { buildElement } from '@dsh-claude-ui/engine/dom'
import { requestFrame } from '@dsh-claude-ui/engine/frame'
import { hostSessionList, hostWorkspaceView, hostWorkspaces } from '@dsh-claude-ui/engine/host'
import type { HostContext } from '@dsh-claude-ui/engine/host'
import { FORK_CHILD_ATTR, FORK_COLLAPSED_ATTR, FORK_DEPTH_PROPERTY, FORK_HIDDEN_ATTR, FORK_PARENT_ATTR, FORK_TOGGLE_ATTR } from '../../constants'
import { buildChevron } from '../../shared/chevron'
import { copy } from './copy'
import { forkOrder, forkPairs } from './tree'
import type { ForkRow } from './tree'

/**
 * The sidebar's fork lineage: a forked session stands indented under the
 * session it came from, behind a branch line, and the source folds its branches
 * from the chevron the feature draws into its row.
 *
 * The host keeps no parent field for an ordinary fork, but the client controller
 * renames every fork to the source's title with its counter moved on
 * (`X` -> `X (1)`, `X (1)` -> `X (2)`), so the title is the lineage the list
 * carries (features/fork-tree/tree.ts). The rows are the host's, drawn flat; the
 * feature writes the lineage order into the workspace view's own session-order
 * store — the same write a drag of a row makes — so the renderer keeps owning
 * its seats and they stay clickable, and marks both rows (fork-tree.css draws
 * the indent, the branch and the fold).
 *
 * The date grouping arranges the same seats by day: with it on, the feature
 * stands down rather than fight it for the order.
 */

/** The list's key prefix before a session id. */
const KEY_PREFIX = 'session:'

export function install(ctx: HostContext) {
  /** The sources the reader folded; only this page's click decides, and a reload opens them again. */
  const folded = new Set<string>()
  let queued: (() => void) | null = null
  let released = false

  /** The rows a pass marked, so a row that left the lineage loses its marks. */
  const marked = new Set<HTMLElement>()

  const schedule = () => {
    if (released || queued !== null) return
    queued = requestFrame({
      write() {
        queued = null
        if (!released) pass()
      },
    })
  }

  /** The rows on the page, by session id. */
  function rowsById() {
    const found = new Map<string, HTMLElement>()
    for (const row of rowList.all()) {
      const key = row.getAttribute(SESSION_ROW_KEY_ATTRIBUTE) ?? ''
      if (!key.startsWith(KEY_PREFIX)) continue
      found.set(key.slice(KEY_PREFIX.length), row)
    }
    return found
  }

  /** The list's sessions, by the titles the lineage reads. */
  function listedRows(): ForkRow[] {
    const listed: ForkRow[] = []
    const list = hostSessionList(ctx)
    for (const id of list?.ids ?? []) {
      const row = list?.byId?.[id]
      if (row === undefined || row === null) continue
      const title = typeof row.title === 'string' && row.title !== '' ? row.title : row.displayTitle
      listed.push({ id, title: typeof title === 'string' ? title : '' })
    }
    return listed
  }

  /**
   * Stand the sidebar's sessions in the lineage's order — a source, then its
   * branches, each branch's own below it — through the workspace view store's
   * own reorder write, the same one a drag of a row makes. The write lands in
   * the store the renderer reads, so the rows keep belonging to it and stay
   * clickable; moving the seats in the DOM instead fought the renderer for its
   * own children, and its keyed re-renders could leave dead rows.
   *
   * Each pass issues the orders the displayed rows still lack. A state the
   * write cannot reach (another sorter owns the order, or the store shape is
   * absent) is remembered so the pass does not write on every refresh; a new
   * lineage or order retries once.
   */
  const ordered = new Set<string>()

  /**
   * The order each account's rows stand in on the page: the DOM is the truth
   * the reader sees, so the desired order moves only the lineage's rows among
   * it and everything else keeps its place.
   *
   * The account keys are the store's own: one per workspace (or the flat
   * key when the view groups flat), `''` for the sessions no workspace owns.
   */
  function orderAccounts(rows: ReadonlyMap<string, HTMLElement>, pairs: ReadonlyMap<string, string>) {
    const view = hostWorkspaceView(ctx)
    const setOrder = view?.actions?.setSessionOrder
    const workspaces = hostWorkspaces(ctx)?.list.getSnapshot()
    if (typeof setOrder !== 'function' || view === null || workspaces === null || workspaces === undefined) return

    const accountOf = new Map<string, string>()
    if (view.getSnapshot().groupBy === 'flat') {
      for (const id of rows.keys()) accountOf.set(id, '__flat_session_order__')
    } else {
      const members = new Set<string>()
      for (const item of workspaces.items) {
        for (const id of item.sessionIds) {
          accountOf.set(id, item.workspaceId)
          members.add(id)
        }
      }
      for (const id of rows.keys()) if (!members.has(id)) accountOf.set(id, '')
    }

    // The displayed order per account, and every account's order as the
    // store's write wants it: the accounts a pass does not touch keep the
    // order they show.
    const displayed = new Map<string, string[]>()
    for (const [id] of rows) {
      const key = accountOf.get(id)
      if (key === undefined) continue
      const order = displayed.get(key) ?? []
      order.push(id)
      displayed.set(key, order)
    }
    const initial: Record<string, string[]> = {}
    for (const [key, order] of displayed) initial[key] = [...order]

    for (const [key, order] of displayed) {
      const desired = forkOrder(order, pairs)
      const signature = `${key}:${order.join(',')}>${desired.join(',')}`
      if (ordered.has(signature) || desired.every((id, at) => order[at] === id)) continue
      ordered.add(signature)
      setOrder(key, desired, initial)
    }
  }

  /** The chevron a source carries: the fold, and the word the fold speaks. */
  function ensureToggle(row: HTMLElement, source: string) {
    let toggle = row.querySelector<HTMLButtonElement>(`[${FORK_TOGGLE_ATTR}]`)
    if (toggle === null) {
      toggle = buildElement('button', 'dsh-claude-fork-toggle')
      toggle.type = 'button'
      toggle.setAttribute(FORK_TOGGLE_ATTR, '')
      toggle.append(buildChevron('M4 6.5 8 10.5 12 6.5', 12))
      toggle.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (folded.has(source)) folded.delete(source)
        else folded.add(source)
        schedule()
      })
      // The chevron stands behind the title, the way Claude's own disclosure
      // does: a control in front of it would push this row's title past the
      // titles of the rows that have no branches, and the list would read as
      // misaligned. Behind it, the title keeps the column every row agrees on,
      // and the running title's own shimmer keeps the box it always had.
      const title = row.querySelector('[data-dsh-claude-part~="row-title"]')
      if (title !== null) title.insertAdjacentElement('afterend', toggle)
      else row.append(toggle)
    }
    const open = !folded.has(source)
    const label = copy(open ? 'forkFold' : 'forkUnfold')
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    toggle.setAttribute('aria-label', label)
    toggle.title = label
  }

  function clearRow(row: HTMLElement) {
    row.removeAttribute(FORK_PARENT_ATTR)
    row.removeAttribute(FORK_CHILD_ATTR)
    row.removeAttribute(FORK_COLLAPSED_ATTR)
    row.removeAttribute(FORK_HIDDEN_ATTR)
    row.style.removeProperty(FORK_DEPTH_PROPERTY)
    row.querySelector(`[${FORK_TOGGLE_ATTR}]`)?.remove()
  }

  /** One pass: read the list's lineage, stand the seats in it, and mark what the stylesheet draws. */
  function pass() {
    const rows = rowsById()
    if (rows.size === 0) return
    if (document.body.hasAttribute('data-dsh-claude-date-groups')) {
      for (const row of marked) clearRow(row)
      marked.clear()
      return
    }
    const listed = listedRows()
    const pairs = forkPairs(listed)

    // The order is a view-store write, not a DOM one: the same write the
    // reader's own drag makes. Where the store's shape is absent the rows keep
    // their drawn order and the marks still draw the lineage where it happens
    // to stand.
    orderAccounts(rows, pairs)

    // A child only stands as one where the list holds its source's row.
    const present = new Set(rows.keys())
    const live = new Map<string, string>()
    for (const [child, source] of pairs) {
      if (!present.has(child) || !present.has(source)) continue
      live.set(child, source)
    }

    const sources = new Set(live.values())
    for (const [id, row] of rows) {
      if (!sources.has(id) && !live.has(id)) {
        if (marked.has(row)) {
          clearRow(row)
          marked.delete(row)
        }
        continue
      }
      marked.add(row)
      row.removeAttribute(FORK_PARENT_ATTR)
      row.removeAttribute(FORK_CHILD_ATTR)
      row.removeAttribute(FORK_COLLAPSED_ATTR)
      row.removeAttribute(FORK_HIDDEN_ATTR)
      if (sources.has(id)) {
        row.setAttribute(FORK_PARENT_ATTR, '')
        ensureToggle(row, id)
        if (folded.has(id)) row.setAttribute(FORK_COLLAPSED_ATTR, '')
      } else {
        row.querySelector(`[${FORK_TOGGLE_ATTR}]`)?.remove()
      }
      const source = live.get(id)
      if (source === undefined) continue
      // Every branch stands one step in from its source, however deep the lineage
      // runs: a fork of a fork keeps the same step, so the list stays a column of
      // rows rather than a staircase of them.
      const depth = 1
      row.setAttribute(FORK_CHILD_ATTR, String(depth))
      row.style.setProperty(FORK_DEPTH_PROPERTY, String(depth))
      let ancestor: string | undefined = source
      const seen = new Set<string>([id])
      while (ancestor !== undefined && !seen.has(ancestor)) {
        seen.add(ancestor)
        if (folded.has(ancestor)) {
          row.setAttribute(FORK_HIDDEN_ATTR, '')
          break
        }
        ancestor = live.get(ancestor)
      }
    }
  }

  const rowList = observeMatches<HTMLElement>(`[${SESSION_ROW_KEY_ATTRIBUTE}]`, schedule)
  schedule()

  return () => {
    released = true
    if (queued !== null) queued()
    queued = null
    rowList.release()
    for (const row of marked) clearRow(row)
    marked.clear()
    folded.clear()
  }
}
