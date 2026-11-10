import { SESSION_RAIL_WIDTH_NARROW, SESSION_RAIL_WIDTH_PX, SESSION_RAIL_WIDTH_STANDARD, SESSION_RAIL_WIDTH_WIDE } from '../../constants'
import type { HostContextPressureProjection, HostWorkspaceListSnapshot } from '@dsh-claude-style/contracts/services'

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
