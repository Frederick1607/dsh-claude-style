import { SESSION_ROW_KEY_ATTRIBUTE } from '@dsh-claude-style/contracts/dom'
import { observeMatches } from '@dsh-claude-style/engine/bus'
import { buildElement } from '@dsh-claude-style/engine/dom'
import { requestFrame } from '@dsh-claude-style/engine/frame'
import { hostSessionList } from '@dsh-claude-style/engine/host'
import type { HostContext } from '@dsh-claude-style/engine/host'
import { FORK_CHILD_ATTR, FORK_COLLAPSED_ATTR, FORK_DEPTH_PROPERTY, FORK_HIDDEN_ATTR, FORK_PARENT_ATTR, FORK_TOGGLE_ATTR } from '../../constants'
import { buildChevron } from '../../shared/chevron'
import { copy } from './copy'
import { forkDepths, forkOrder, forkPairs } from './tree'
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
 * feature moves each child's seat under its source and marks both rows
 * (fork-tree.css draws the indent, the branch and the fold).
 *
 * The date grouping arranges the same seats by day: with it on, the feature
 * stands down rather than fight it for the order.
 */

/** The list's key prefix before a session id. */
const KEY_PREFIX = 'session:'

/** One list's own seats, as a pass reads them: the session id each belongs to. */
interface Seat {
  id: string
  seat: HTMLElement
  row: HTMLElement
}

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

  /** One row's seats, by the list they stand in: the host draws every row inside a single-child box, and the boxes are the list's seats. */
  function seatsOf(rows: Map<string, HTMLElement>) {
    const lists = new Map<HTMLElement, Seat[]>()
    for (const [id, row] of rows) {
      const seat = row.parentElement
      const list = seat?.parentElement
      if (seat === null || seat === undefined || list === null || list === undefined) continue
      const seats = lists.get(list) ?? []
      seats.push({ id, seat, row })
      lists.set(list, seats)
    }
    return lists
  }

  /**
   * Stand one list's seats in the lineage's order: a source, then its branches,
   * each branch's own below it.
   *
   * The seats move among the slots the list already gives them. The list's
   * other children — the workspace's own header above them, its "show more" row
   * below — are not seats, and keep their places: a seat written in front of the
   * list's first child would stand over the workspace's title.
   */
  function orderList(list: HTMLElement, seats: Seat[], pairs: ReadonlyMap<string, string>) {
    const byId = new Map(seats.map((seat) => [seat.id, seat]))
    const desired = forkOrder(seats.map((seat) => seat.id), pairs).map((id) => byId.get(id)?.seat)
    const slots = new Set(seats.map((seat) => seat.seat))
    const current = [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement && slots.has(child))
    for (let at = 0; at < desired.length; at += 1) {
      const want = desired[at]
      if (want === undefined || current[at] === want) continue
      list.insertBefore(want, current[at] ?? null)
      const from = current.indexOf(want)
      if (from !== -1) current.splice(from, 1)
      current.splice(at, 0, want)
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
    const depths = forkDepths(pairs)
    for (const [list, seats] of seatsOf(rows)) orderList(list, seats, pairs)

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
      const depth = depths.get(id) ?? 1
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
