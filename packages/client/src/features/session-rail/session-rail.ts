import { CONVERSATION_CONTENT_SELECTOR, CONVERSATION_SESSION_ATTRIBUTE } from '@dsh-claude-style/contracts/dom'
import { observeMatches, subscribeMutations } from '@dsh-claude-style/engine/bus'
import { buildElement, setAttributeIfChanged, writeTextInPlace } from '@dsh-claude-style/engine/dom'
import { requestFrame } from '@dsh-claude-style/engine/frame'
import { currentSession, currentSessionId, hostUiSession, hostWorkspaces } from '@dsh-claude-style/engine/host'
import type { HostContext } from '@dsh-claude-style/engine/host'
import type { HostContextPressureProjection } from '@dsh-claude-style/contracts/services'
import { SESSION_RAIL_ATTR, SESSION_RAIL_CLOSED, SESSION_RAIL_HOST_ATTR, SESSION_RAIL_OPEN, SESSION_RAIL_PART_ATTR, SESSION_RAIL_WIDTH_PROPERTY } from '../../constants'
import { readPrefs, subscribePrefs } from '../../core/prefs'
import { formatCompactTokens } from '../../shared/format'
import { copy } from './copy'
import { railPath, railReading, railWidthPx, railWorkspace } from './reading'

/**
 * The session rail: the column beside the conversation that names the
 * workspace the session runs in and reads the context it fills, the way
 * Claude's own app keeps its Session details beside the messages.
 *
 * The host draws the conversation body under the page's phase root, its
 * children the scroller and the width handles (`chat.content`, the contract
 * the column scale already reads). The rail takes the body's right band: it
 * hangs in the body as its third child, and the scroller beside it keeps only
 * what the rail leaves (session-rail.css), so nothing lies under the rail and
 * the messages, the composer and the mascot stay inside the room that is left.
 * The header above the body keeps the full width, where the host's own controls
 * stand.
 *
 * The rail's pref gates the install; the column width is a preference of its
 * own, so a change re-draws the band without rebuilding the rail. The fold
 * button leaves a narrow strip standing rather than taking the rail away: the
 * way back stays where the reader left it.
 */

interface RailRefs {
  root: HTMLElement
  toggle: HTMLButtonElement
  body: HTMLElement
  workspaceName: HTMLElement
  workspacePath: HTMLElement
  percent: HTMLElement
  tokens: HTMLElement
  bar: HTMLElement
  fill: HTMLElement
  used: HTMLElement
  free: HTMLElement
  window: HTMLElement
}

function buildChevron() {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('width', '14')
  icon.setAttribute('height', '14')
  icon.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  // The chevron points at the column the rail stands in: right while the rail
  // is open, left while it is folded to its strip.
  path.setAttribute('d', 'M6 3.5 10.5 8 6 12.5')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  icon.append(path)
  return icon
}

/** The part mark each element of the rail carries, so a lane reads the element it means without spelling a class name. */
function markPart<T extends HTMLElement>(element: T, part: string) {
  element.setAttribute(SESSION_RAIL_PART_ATTR, part)
  return element
}

function buildRail(): RailRefs {
  const root = markPart(buildElement('aside', 'dsh-claude-session-rail'), 'rail')
  root.setAttribute('aria-label', copy('railTitle'))
  const head = buildElement('div', 'dsh-claude-session-rail-head')
  const title = buildElement('span', 'dsh-claude-session-rail-title', copy('railTitle'))
  const toggle = markPart(buildElement('button', 'dsh-claude-session-rail-toggle'), 'toggle')
  toggle.type = 'button'
  toggle.append(buildChevron())
  head.append(title, toggle)

  const body = markPart(buildElement('div', 'dsh-claude-session-rail-body'), 'body')

  const environment = buildElement('section', 'dsh-claude-session-rail-section')
  environment.setAttribute('data-dsh-claude-rail-section', 'environment')
  const environmentTitle = buildElement('h2', 'dsh-claude-session-rail-section-title', copy('railEnvironment'))
  const workspace = buildElement('div', 'dsh-claude-session-rail-workspace')
  const workspaceName = markPart(buildElement('span', 'dsh-claude-session-rail-workspace-name'), 'workspace-name')
  const workspacePath = markPart(buildElement('span', 'dsh-claude-session-rail-workspace-path'), 'workspace-path')
  workspace.append(workspaceName, workspacePath)
  environment.append(environmentTitle, workspace)

  const context = buildElement('section', 'dsh-claude-session-rail-section')
  context.setAttribute('data-dsh-claude-rail-section', 'context')
  const contextTitle = buildElement('h2', 'dsh-claude-session-rail-section-title', copy('railContext'))
  const reading = buildElement('div', 'dsh-claude-session-rail-reading')
  const percent = markPart(buildElement('span', 'dsh-claude-session-rail-percent'), 'percent')
  const tokens = markPart(buildElement('span', 'dsh-claude-session-rail-tokens'), 'tokens')
  const bar = buildElement('div', 'dsh-claude-session-rail-bar')
  bar.setAttribute('role', 'img')
  const fill = markPart(buildElement('div', 'dsh-claude-session-rail-fill'), 'fill')
  bar.append(fill)
  const rows = buildElement('dl', 'dsh-claude-session-rail-rows')
  const used = buildRow(rows, copy('railUsed'))
  const free = buildRow(rows, copy('railFree'))
  const window = buildRow(rows, copy('railWindow'))
  reading.append(percent, tokens)
  context.append(contextTitle, reading, bar, rows)

  body.append(environment, context)
  root.append(head, body)

  return { root, toggle, body, workspaceName, workspacePath, percent, tokens, bar, fill, used, free, window }
}

/** One figure row: its name from the copy, its value written by the refresh. */
function buildRow(list: HTMLElement, label: string) {
  const row = buildElement('div', 'dsh-claude-session-rail-row')
  const term = buildElement('dt', 'dsh-claude-session-rail-row-label', label)
  const value = markPart(buildElement('dd', 'dsh-claude-session-rail-row-value'), 'row-value')
  row.append(term, value)
  list.append(row)
  return value
}

export function install(ctx: HostContext) {
  let folded = false
  let host: HTMLElement | null = null
  let queued: (() => void) | null = null
  let released = false
  const refs = buildRail()

  /** The source the rail follows, and the one whose subscription is open. */
  let listSource: { subscribe?(listener: () => void): () => void } | null = null
  let listOff: (() => void) | null = null
  let sessionSource: { subscribe?(listener: () => void): () => void } | null = null
  let sessionOff: (() => void) | null = null
  let pressureSource: { subscribe?(listener: () => void): () => void } | null = null
  let pressureOff: (() => void) | null = null
  /** The session the pressure subscription answers for: the face moves with the session, not with the read. */
  let pressureSession: string | null = null
  /** The conversation body's own session mark, which changes when the shell switches sessions. */
  let sessionWatchOff: (() => void) | null = null

  /** Coalesce the writes of one frame: a projection answers on every token, the rail reads once. */
  function schedule() {
    if (released || queued !== null) return
    queued = requestFrame({
      write() {
        queued = null
        if (!released) write()
      },
    })
  }

  /** Open or close one subscription, keeping the previous one's teardown. */
  function follow(source: { subscribe?(listener: () => void): () => void } | null, off: (() => void) | null) {
    off?.()
    if (source === null || typeof source.subscribe !== 'function') return null
    return source.subscribe(schedule)
  }

  /**
   * Subscribe the first time the page serves each source: the workspace list
   * and the shell's shown session. The services' own objects are not compared
   * on every read (a face can be a fresh wrapper), so a bound source stays
   * bound until the rail detaches, where a re-subscribe per read would keep
   * the frame scheduler answering itself.
   */
  function followSources() {
    if (listSource === null) {
      const list = hostWorkspaces(ctx)?.list ?? null
      if (list !== null) {
        listSource = list
        listOff = follow(list, listOff)
      }
    }
    if (sessionSource === null) {
      const current = hostUiSession(ctx)?.current ?? null
      if (current !== null) {
        sessionSource = current
        sessionOff = follow(current, sessionOff)
      }
    }
  }

  /** Follow the shown session's pressure projection, moving the subscription only when the session itself changes. */
  function followPressure() {
    const sessionId = currentSessionId(ctx)
    if (sessionId === pressureSession) return
    pressureOff?.()
    pressureOff = null
    pressureSession = sessionId
    const face = currentSession(ctx)?.projections?.faceOf('contextPressure') ?? null
    if (face !== null) pressureSource = face
    pressureOff = follow(face, null)
  }

  /** Fold the rail to its strip or stand it open again; the body and the scroller follow through the attribute. */
  function applyFold() {
    if (host === null) return
    setAttributeIfChanged(host, SESSION_RAIL_ATTR, folded ? SESSION_RAIL_CLOSED : SESSION_RAIL_OPEN)
    const label = folded ? copy('railExpand') : copy('railCollapse')
    refs.toggle.setAttribute('aria-expanded', folded ? 'false' : 'true')
    refs.toggle.setAttribute('aria-label', label)
    refs.toggle.title = label
  }

  function applyWidth() {
    if (host === null) return
    host.style.setProperty(SESSION_RAIL_WIDTH_PROPERTY, `${railWidthPx(readPrefs().sessionRailWidth)}px`)
  }

  /** Write the reading and the environment: the counts the host answers, its dashes where it answers none. */
  function write() {
    if (host === null) return
    followSources()
    followPressure()

    const sessionId = currentSessionId(ctx)
    const workspace = railWorkspace(hostWorkspaces(ctx)?.list.getSnapshot() ?? null, sessionId)
    writeTextInPlace(refs.workspaceName, workspace === null ? copy('railNoWorkspace') : workspace.title)
    writeTextInPlace(refs.workspacePath, workspace === null ? '' : railPath(workspace.path))
    refs.workspacePath.title = workspace === null ? '' : workspace.path

    const pressure = currentSession(ctx)?.projections?.faceOf('contextPressure')?.getSnapshot() as HostContextPressureProjection | null | undefined
    const reading = railReading(pressure)
    const percentText = reading.percent === null ? copy('railUnknown') : copy('railPercentUsed', { percent: reading.percent })
    writeTextInPlace(refs.percent, percentText)
    const windowText = reading.window === null ? copy('railUnknown') : formatCompactTokens(reading.window)
    writeTextInPlace(refs.tokens, `${reading.used === null ? copy('railUnknown') : formatCompactTokens(reading.used)} / ${windowText}`)
    setAttributeIfChanged(refs.bar, 'aria-label', `${percentText} · ${reading.used === null ? copy('railUnknown') : formatCompactTokens(reading.used)} / ${windowText}`)
    refs.fill.style.width = `${reading.percent === null ? 0 : reading.percent}%`
    writeTextInPlace(refs.used, reading.used === null ? copy('railUnknown') : formatCompactTokens(reading.used))
    writeTextInPlace(refs.free, reading.free === null ? copy('railUnknown') : formatCompactTokens(reading.free))
    writeTextInPlace(refs.window, reading.window === null ? copy('railUnknown') : formatCompactTokens(reading.window))
  }

  /** Take the rail out of the body it hangs in: the host keeps its own children and the prefs keep their values. */
  function detach() {
    pressureOff?.()
    pressureOff = null
    pressureSource = null
    pressureSession = null
    sessionWatchOff?.()
    sessionWatchOff = null
    listOff?.()
    listOff = null
    listSource = null
    sessionOff?.()
    sessionOff = null
    sessionSource = null
    if (host !== null) {
      refs.root.remove()
      host.removeAttribute(SESSION_RAIL_HOST_ATTR)
      host.removeAttribute(SESSION_RAIL_ATTR)
      host.style.removeProperty(SESSION_RAIL_WIDTH_PROPERTY)
      host = null
    }
  }

  /** Hang the rail in the body the phase root holds now, and read it. */
  function attach() {
    const next = bodies.all()[0] ?? null
    if (next === host) {
      if (next !== null) write()
      return
    }
    detach()
    if (next === null) return
    host = next
    host.setAttribute(SESSION_RAIL_HOST_ATTR, '')
    applyWidth()
    applyFold()
    host.append(refs.root)
    // The body carries the shown session: a switch rewrites that mark rather
    // than the body, so the rail hears the switch here.
    sessionWatchOff = subscribeMutations(host, { attributes: true, attributeFilter: [CONVERSATION_SESSION_ATTRIBUTE] }, schedule)
    followSources()
    write()
  }

  // The body arrives when the conversation mounts and stays while the session
  // switches: the phase root it hangs under changes its mark instead of its
  // child (the hero page keeps the rail folded away through the stylesheet).
  const bodies = observeMatches<HTMLElement>(CONVERSATION_CONTENT_SELECTOR, attach)

  refs.toggle.addEventListener('click', () => {
    folded = !folded
    applyFold()
  })

  const stopPrefs = subscribePrefs(() => {
    applyWidth()
    schedule()
  })

  attach()

  return () => {
    released = true
    if (queued !== null) queued()
    queued = null
    stopPrefs()
    bodies.release()
    detach()
  }
}
