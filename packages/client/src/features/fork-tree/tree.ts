/**
 * The sidebar's fork lineage, read from the titles the host gives a fork's
 * child: the client controller renames a fork to the source's title with its
 * counter moved on (`X` -> `X (1)`, `X (1)` -> `X (2)`), and the host keeps no
 * parent field of its own beside that. A pair is drawn only where one row's
 * title answers another's exactly, so two sessions that merely share a title
 * are never nested under one another.
 */

/** One row of the sidebar's list, as far as the lineage reads it. */
export interface ForkRow {
  id: string
  title: string
}

/** One fork's counter, the way the controller writes it: ASCII or full-width parentheses around a whole number, the source's own spacing kept before it. */
const FORK_COUNTER = /^(.*?)([(（])(\d+)([)）])$/u

/**
 * The titles a forked child's title was made from, nearest first.
 *
 * A first fork takes the source's title and adds ` (1)`; a later one moves the
 * counter it already carries, so the source of `X (2)` is `X (1)` and the
 * source of `X (1)` is `X`. A title without a counter names no source.
 *
 * @param title - the row's title, as the list carries it.
 * @returns the source's title (one candidate), or nothing.
 */
export function forkSourceTitles(title: string): string[] {
  const match = FORK_COUNTER.exec(typeof title === 'string' ? title.trim() : '')
  if (match === null) return []
  // The source's own spelling stands before the counter: a counter moved on
  // keeps it exactly (`X (1)` -> `X (2)`), while the first fork added ` (1)`
  // after the source's title, so that space is the counter's, not the source's.
  const base = match[1] ?? ''
  const count = Number(match[3])
  if (!Number.isSafeInteger(count) || count < 1) return []
  if (count > 1) return [`${base}${match[2]}${count - 1}${match[4]}`]
  return [base.trimEnd()]
}

/**
 * The fork pairs the list holds: each child's id against the id of the row
 * whose title names it. A title two rows answer, or one the row answers itself,
 * draws no pair rather than a guess.
 *
 * @param rows - the sidebar's sessions, in the list's own order.
 * @returns one entry per child whose source the list holds exactly once.
 */
export function forkPairs(rows: readonly ForkRow[]): Map<string, string> {
  const owners = new Map<string, string[]>()
  for (const row of rows) {
    const found = owners.get(row.title) ?? []
    found.push(row.id)
    owners.set(row.title, found)
  }
  const pairs = new Map<string, string>()
  for (const row of rows) {
    for (const source of forkSourceTitles(row.title)) {
      const found = owners.get(source)
      if (found === undefined || found.length !== 1) continue
      if (found[0] === row.id) continue
      pairs.set(row.id, found[0])
      break
    }
  }
  return pairs
}

/**
 * How deep each child stands under its root: a fork of a fork is indented
 * twice. A lineage that closes on itself stops at the point it closes, so a
 * cycle cannot loop the walk.
 *
 * @param pairs - the child-to-source map forkPairs answered.
 * @returns each child's depth, at least one.
 */
export function forkDepths(pairs: ReadonlyMap<string, string>): Map<string, number> {
  const depths = new Map<string, number>()
  for (const id of pairs.keys()) {
    let depth = 1
    let current = pairs.get(id)
    const seen = new Set<string>([id])
    while (current !== undefined && !seen.has(current)) {
      seen.add(current)
      const next = pairs.get(current)
      if (next === undefined) break
      depth += 1
      current = next
    }
    depths.set(id, depth)
  }
  return depths
}

/**
 * One list's order in the lineage: each source stands where the list had it,
 * its branches directly behind it (and behind each branch's own), and a row the
 * lineage does not place keeps the list's order at the root level. A lineage
 * that closes on itself leaves each member at the root level rather than
 * losing a row.
 *
 * @param ids - the list's sessions, in the order it stands in.
 * @param pairs - the child-to-source map forkPairs answered.
 * @returns the ids in the order the lineage draws them, every id once.
 */
export function forkOrder(ids: readonly string[], pairs: ReadonlyMap<string, string>): string[] {
  const present = new Set(ids)
  const children = new Map<string, string[]>()
  for (const id of ids) {
    const source = pairs.get(id)
    if (source === undefined || !present.has(source)) continue
    const found = children.get(source) ?? []
    found.push(id)
    children.set(source, found)
  }
  const order: string[] = []
  const placed = new Set<string>()
  const push = (id: string) => {
    if (placed.has(id)) return
    placed.add(id)
    order.push(id)
    for (const child of children.get(id) ?? []) push(child)
  }
  for (const id of ids) {
    const source = pairs.get(id)
    if (source === undefined || !present.has(source)) push(id)
  }
  for (const id of ids) push(id)
  return order
}
