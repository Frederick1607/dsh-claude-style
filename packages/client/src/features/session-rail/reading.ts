import { SESSION_RAIL_WIDTH_NARROW, SESSION_RAIL_WIDTH_PX, SESSION_RAIL_WIDTH_STANDARD, SESSION_RAIL_WIDTH_WIDE } from '../../constants'
import type { HostContextBreakdownProjection, HostContextPressureProjection, HostFeedEntry, HostWorkspaceListSnapshot } from '@dsh-claude-ui/contracts/services'

/**
 * What the session rail draws, worked out without the page: the context
 * reading the host's pressure projection carries, the workspace the shown
 * session belongs to, and the path line under its name. The rail's DOM
 * (session-rail.ts) is what writes these into the column.
 */

/** The context's occupancy as the rail reads it: the percentage, the counts, and the window they stand in. */
export interface RailReading {
  /** The share of the window the context fills, whole and at most 100; null while the size is unknown. */
  percent: number | null
  /** The tokens the context holds; null while the host reports none. */
  used: number | null
  /** What the window still holds; null while either end is unknown. */
  free: number | null
  /** The window's size; null while the host reports none. */
  window: number | null
}

/** One workspace's identity as the Environment section shows it. */
export interface RailWorkspace {
  title: string
  path: string
}

/**
 * Read the host's context-pressure projection: the composer's own meter reads
 * the same figures (`session-stats.ts`), which are the projected tokens of the
 * running turn, or the pressure figure once it settles.
 *
 * @param pressure - the projection's snapshot, or null while the host carries none.
 * @returns the reading, its unknown ends left null.
 */
export function railReading(pressure: HostContextPressureProjection | null | undefined): RailReading {
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const window = pressure?.contextWindow
  const held = typeof used === 'number' && Number.isFinite(used) && used >= 0 ? used : null
  const limit = typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : null
  if (held === null) return { percent: null, used: null, free: limit, window: limit }
  if (limit === null) return { percent: null, used: held, free: null, window: null }
  return {
    percent: Math.min(100, Math.round(held / limit * 100)),
    used: held,
    free: Math.max(0, limit - held),
    window: limit,
  }
}

/**
 * The workspace the shown session belongs to: the row whose sessions hold it.
 * A session no row holds yet answers null, and the section says so rather than
 * naming a workspace the session never joined.
 *
 * @param snapshot - the host's workspace list.
 * @param sessionId - the shown session's id, or null while the shell shows none.
 * @returns the row's title and path, or null.
 */
export function railWorkspace(snapshot: HostWorkspaceListSnapshot | null | undefined, sessionId: string | null | undefined): RailWorkspace | null {
  if (snapshot === null || snapshot === undefined) return null
  if (typeof sessionId !== 'string' || sessionId === '') return null
  for (const row of snapshot.items) {
    if (row === null || row === undefined || !Array.isArray(row.sessionIds)) continue
    if (!row.sessionIds.includes(sessionId)) continue
    return {
      title: typeof row.title === 'string' ? row.title : '',
      path: typeof row.path === 'string' ? row.path : '',
    }
  }
  return null
}

/**
 * The path under the workspace's name: the reader's home folded to `~`, the
 * way the host's own rows write it, so a long path loses its head and keeps
 * the folder the reader works in.
 *
 * @param path - the workspace's absolute path.
 * @returns the folded path, or the path itself when it starts nowhere near a home.
 */
export function railPath(path: string) {
  if (typeof path !== 'string' || path === '') return ''
  const home = /^(?:\/Users|\/home)\/[^/]+(?=\/|$)/.exec(path)
  return home === null ? path : `~${path.slice(home[0].length)}`
}

/**
 * The width one width choice draws, in pixels: the narrow, standard and wide
 * columns (SESSION_RAIL_WIDTH_PX). A stored value this build does not name
 * reads as the standard column, the way every clamped preference falls back.
 *
 * @param choice - the stored `sessionRailWidth` value.
 * @returns the column width in pixels.
 */
export function railWidthPx(choice: string | null | undefined) {
  if (choice === SESSION_RAIL_WIDTH_NARROW) return SESSION_RAIL_WIDTH_PX[SESSION_RAIL_WIDTH_NARROW]
  if (choice === SESSION_RAIL_WIDTH_WIDE) return SESSION_RAIL_WIDTH_PX[SESSION_RAIL_WIDTH_WIDE]
  return SESSION_RAIL_WIDTH_PX[SESSION_RAIL_WIDTH_STANDARD]
}

/** One file the session delivered, as the rail's Outputs section shows it. */
export interface RailOutput {
  /** The path the call declared, as the host recorded it. */
  path: string
  /** The path's trailing segment, what the row shows at a glance. */
  name: string
  /** The description the call carried, or an empty string. */
  description: string
}

/** The trailing path segment, slash- or backslash-separated; a trailing separator is the part it closes. */
export function fileBasename(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  if (trimmed === '') return path.trim()
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return at === -1 ? trimmed : trimmed.slice(at + 1)
}

/**
 * Fold one feed window's declarations into the outputs the section lists: the
 * files a `present` call named, in declaration order, with a later declaration
 * of the same path taking the newer description and its place at the end.
 * Malformed declarations are dropped rather than guessed.
 *
 * @param previous - what the feed loaded before, or nothing on a replace.
 * @param entries - the window's entries, or only the ones just appended.
 * @returns the outputs in the order they were last declared.
 */
export function railOutputsAfter(previous: readonly RailOutput[] | null | undefined, entries: readonly HostFeedEntry[]): RailOutput[] {
  const kept = new Map<string, RailOutput>()
  for (const output of previous ?? []) kept.set(output.path, output)
  for (const entry of entries) {
    const event = entry?.event
    if (event === null || event === undefined || event.type !== 'deliverables/presented') continue
    const files = event.data?.files
    if (!Array.isArray(files)) continue
    for (const file of files) {
      const path = typeof file?.path === 'string' ? file.path.trim() : ''
      if (path === '') continue
      kept.delete(path)
      kept.set(path, { path, name: fileBasename(path), description: typeof file.description === 'string' ? file.description : '' })
    }
  }
  return [...kept.values()]
}

/** The outputs one whole feed window declares; a replace reads through this. */
export function railOutputs(entries: readonly HostFeedEntry[]): RailOutput[] {
  return railOutputsAfter(null, entries)
}

/** The context matrix's four parts: the three the host prices, and the window still free. */
export type RailCell = 'system' | 'tools' | 'conversation' | 'free'

/** The context's own composition, in the reading's tokens: what the window holds, by the kind of thing it holds. */
export interface RailParts {
  system: number
  tools: number
  conversation: number
}

/**
 * The composition the host's breakdown projection carries, scaled to the
 * reading's own used figure so the matrix and the meter above it speak of the
 * same total. A breakdown the host carries none of answers null, and the matrix
 * draws only free space.
 *
 * @param used - the tokens the reading says are held, or null while unknown.
 * @param breakdown - the token meter's composition of the surface.
 * @returns the three priced parts scaled to `used`, or null without a breakdown.
 */
export function railContextParts(used: number | null, breakdown: HostContextBreakdownProjection | null | undefined): RailParts | null {
  if (breakdown === null || breakdown === undefined) return null
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
  const system = count(breakdown.systemTokens)
  const tools = count(breakdown.toolsTokens)
  const conversation = count(breakdown.messageTokens)
  const total = system + tools + conversation
  if (total <= 0) return null
  if (used === null || used <= 0 || Math.round(used) === Math.round(total)) {
    return { system: Math.round(system), tools: Math.round(tools), conversation: Math.round(conversation) }
  }
  const scale = used / total
  const parts = {
    system: Math.round(system * scale),
    tools: Math.round(tools * scale),
    conversation: Math.round(conversation * scale),
  }
  // Rounding may leave the parts a token or two off the total the meter shows;
  // the conversation part takes the difference, being the largest and last.
  const drift = Math.round(used) - (parts.system + parts.tools + parts.conversation)
  parts.conversation = Math.max(0, parts.conversation + drift)
  return parts
}

/** The matrix's shape: ten columns and four rows, a cell worth one fortieth of the window. */
export const RAIL_MATRIX_COLUMNS = 10
export const RAIL_MATRIX_ROWS = 4

/**
 * The matrix's cells, in reading order: each cell stands for one part of the
 * window, from the system prompt through the messages and on into the free
 * space, so the reader reads the composition left to right and top to bottom.
 *
 * @param parts - the composition railContextParts answered, or null.
 * @param window - the window's size, or null while unknown.
 * @param cells - how many cells the matrix draws; the last one is never a
 *   fraction, the window being one whole.
 * @returns one part per cell.
 */
export function railMatrixCells(parts: RailParts | null, window: number | null, cells: number = RAIL_MATRIX_COLUMNS * RAIL_MATRIX_ROWS): RailCell[] {
  const count = Math.max(1, Math.floor(cells))
  const free = new Array<RailCell>(count).fill('free')
  if (parts === null || window === null || !Number.isFinite(window) || window <= 0) return free
  const system = Math.max(0, parts.system)
  const tools = Math.max(0, parts.tools)
  const conversation = Math.max(0, parts.conversation)
  const held = Math.min(window, system + tools + conversation)
  if (held <= 0) return free
  const step = window / count
  const cellsOut: RailCell[] = []
  for (let at = 0; at < count; at += 1) {
    const centre = (at + 0.5) * step
    if (centre <= system) cellsOut.push('system')
    else if (centre <= system + tools) cellsOut.push('tools')
    else if (centre <= held) cellsOut.push('conversation')
    else cellsOut.push('free')
  }
  return cellsOut
}
