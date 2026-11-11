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

/** The host's fixed text density: the token meter prices the same content the same way (dsh-token-meter). */
const CHARS_PER_TOKEN = 4

/** The turns the treemap draws as tiles itself; older ones join one tile that sums them. */
const TREEMAP_TURNS = 5

/** One turn's share of the conversation, priced from the log the rail reads. */
export interface RailTurnBudget {
  turn: number
  tokens: number
}

/** What the session's log says fills the window: the system prompt, the tool schemas, and the conversation, by turn. */
export interface RailComposition {
  system: number
  tools: number
  turns: RailTurnBudget[]
}

/** One tile of the context treemap: a kind of token, the turn it belongs to, and its tokens. */
export interface RailTile {
  key: 'system' | 'tools' | 'conversation' | 'free'
  /** The turn a conversation tile speaks for; null for every other kind. */
  turn: number | null
  /** How many turns a grouped conversation tile sums; 1 for one turn. */
  group: number
  tokens: number
}

function priceText(text: string) {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Price one content-block list the way the host's estimate does: text by density, the rest by its JSON. */
function priceBlocks(content: unknown) {
  if (!Array.isArray(content)) return 0
  let tokens = 0
  for (const block of content) {
    const shape = block as { type?: unknown, text?: unknown }
    if (shape.type === 'text' || shape.type === 'reasoning') tokens += priceText(typeof shape.text === 'string' ? shape.text : '')
    else tokens += priceText(JSON.stringify(block))
  }
  return tokens
}

/**
 * The composition of the window, priced from the session's own log: the last
 * system prompt the host sent, the last request's tool schemas, and the
 * messages under the turn they belong to. A log the rail has not loaded yet
 * answers nothing, and the section says so.
 *
 * @param entries - the feed window the rail holds.
 * @returns the priced parts, each turn's own tokens summed.
 */
export function railComposition(entries: readonly HostFeedEntry[] | null | undefined): RailComposition {
  return railCompositionAfter(null, entries)
}

/**
 * The composition after a feed window: a replace hands the whole window, an
 * append only the entries that arrived, so a rail that folds as the session
 * runs keeps every turn it has already priced.
 *
 * @param previous - the composition the rail holds, or null for a fresh window.
 * @param entries - the entries the feed handed: a replace, or the arrival.
 * @returns the composition grown by those entries.
 */
export function railCompositionAfter(previous: RailComposition | null, entries: readonly HostFeedEntry[] | null | undefined): RailComposition {
  const held = previous ?? { system: 0, tools: 0, turns: [] }
  const merged = new Map<number, number>()
  for (const budget of held.turns) merged.set(budget.turn, budget.tokens)
  let system = held.system
  let tools = held.tools
  // A log that opens on messages without a `turn/start` still belongs to the
  // session's first turn: pricing it under turn zero would drop it.
  let turn = held.turns.length === 0 ? 1 : held.turns[held.turns.length - 1]!.turn
  const turns = merged
  for (const entry of entries ?? []) {
    const event = entry?.event as { type?: string, data?: Record<string, unknown> } | null | undefined
    if (event === null || event === undefined || typeof event.type !== 'string') continue
    const data = event.data ?? {}
    if (typeof data.turn === 'number' && Number.isFinite(data.turn) && data.turn > 0) turn = data.turn
    if (event.type === 'turn/start' || event.type === 'turn/end') continue
    if (event.type === 'system/message') {
      const message = data.message as { content?: unknown } | undefined
      system = Math.max(system, priceBlocks(message?.content))
      continue
    }
    if (event.type === 'request/header') {
      const header = data.header as { tools?: unknown } | undefined
      tools = header?.tools === undefined ? tools : priceText(JSON.stringify(header.tools))
      continue
    }
    if (event.type !== 'user/message' && event.type !== 'assistant/message' && event.type !== 'tool/result' && event.type !== 'assistant/reasoning') continue
    if (turn <= 0) turn = 1
    const content = event.type === 'tool/result' ? (data.message as { content?: unknown } | undefined)?.content : data.content
    const priced = priceBlocks(content)
    if (priced > 0) turns.set(turn, (turns.get(turn) ?? 0) + priced)
  }
  return {
    system,
    tools,
    turns: [...turns].sort(([left], [right]) => left - right).map(([turnNumber, tokens]) => ({ turn: turnNumber, tokens })),
  }
}

/**
 * The treemap's tiles, in reading order: the system prompt, the tool schemas,
 * the most recent turns (the older ones folded into one tile), and the window
 * still free.
 *
 * @param composition - the log's own composition.
 * @param conversation - the conversation's total as the host's breakdown priced it, when it did.
 * @param free - the tokens the window still holds, when the host reports them.
 * @returns the tiles, each worth its tokens.
 */
export function railTreemapTiles(composition: RailComposition, conversation: number | null, free: number | null): RailTile[] {
  const tiles: RailTile[] = []
  if (composition.system > 0) tiles.push({ key: 'system', turn: null, group: 1, tokens: composition.system })
  if (composition.tools > 0) tiles.push({ key: 'tools', turn: null, group: 1, tokens: composition.tools })
  const turns = composition.turns
  const recent = turns.slice(-TREEMAP_TURNS)
  const older = turns.slice(0, -TREEMAP_TURNS)
  for (const budget of recent) tiles.push({ key: 'conversation', turn: budget.turn, group: 1, tokens: budget.tokens })
  if (older.length > 0) tiles.push({ key: 'conversation', turn: null, group: older.length, tokens: older.reduce((sum, budget) => sum + budget.tokens, 0) })
  const priced = tiles.reduce((sum, tile) => sum + tile.tokens, 0)
  const held = conversation === null ? priced : Math.max(conversation, priced)
  if (held > priced) tiles.push({ key: 'conversation', turn: null, group: 0, tokens: held - priced })
  if (free !== null && free > 0) tiles.push({ key: 'free', turn: null, group: 1, tokens: free })
  return tiles
}

/**
 * The tiles in rows: the larger a tile, the more of its row it takes. Tiles keep
 * their reading order, and the rows are balanced by tokens so no row stands
 * nearly empty.
 *
 * @param tiles - the treemap's tiles, in reading order.
 * @param rows - how many rows the treemap draws.
 * @returns one array of tiles per row.
 */
export function railTreemapRows(tiles: readonly RailTile[], rows: number): RailTile[][] {
  const count = Math.max(1, Math.floor(rows))
  if (tiles.length === 0) return []
  if (count === 1) return [[...tiles]]
  const total = tiles.reduce((sum, tile) => sum + Math.max(0, tile.tokens), 0) || tiles.length
  const out: RailTile[][] = []
  let row: RailTile[] = []
  let running = 0
  for (const [at, tile] of tiles.entries()) {
    row.push(tile)
    running += Math.max(0, tile.tokens)
    const left = tiles.length - at - 1
    const rowsLeft = count - out.length
    const boundary = total * (out.length + 1) / count
    if (rowsLeft > 1 && running >= boundary && left >= rowsLeft - 1) {
      out.push(row)
      row = []
    }
  }
  if (row.length > 0) out.push(row)
  return out
}
