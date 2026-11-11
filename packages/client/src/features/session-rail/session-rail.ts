import { CONVERSATION_CONTENT_SELECTOR, CONVERSATION_SESSION_ATTRIBUTE } from '@dsh-claude-ui/contracts/dom'
import { observeMatches, subscribeMutations } from '@dsh-claude-ui/engine/bus'
import { buildElement, setAttributeIfChanged, writeTextInPlace } from '@dsh-claude-ui/engine/dom'
import { requestFrame } from '@dsh-claude-ui/engine/frame'
import { currentSession, currentSessionId, hostSessions, hostUiSession, hostWorkspaces } from '@dsh-claude-ui/engine/host'
import type { HostContext } from '@dsh-claude-ui/engine/host'
import { SESSION_RAIL_CELL_ATTR, SESSION_RAIL_LEGEND_ATTR } from '../../constants'
import type { HostContextBreakdownProjection, HostContextPressureProjection } from '@dsh-claude-ui/contracts/services'
import { SESSION_RAIL_ATTR, SESSION_RAIL_CLOSED, SESSION_RAIL_HOST_ATTR, SESSION_RAIL_OPEN, SESSION_RAIL_PART_ATTR, SESSION_RAIL_WIDTH_PROPERTY } from '../../constants'
import { readPrefs, subscribePrefs } from '../../core/prefs'
import { buildChevron } from '../../shared/chevron'
import { formatCompactTokens } from '../../shared/format'
import { copy } from './copy'
import { railContextParts, railMatrixCells, railOutputs, railOutputsAfter, railPath, railReading, railWidthPx, railWorkspace, RAIL_MATRIX_COLUMNS, RAIL_MATRIX_ROWS } from './reading'
import type { RailOutput } from './reading'

/**
 * The session rail: the column beside the conversation that names the
 * workspace the session runs in, reads the context it fills, and lists the
 * files it delivered, the way Claude's own app keeps its Session details
 * beside the messages.
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
 * way back stays where the reader left it. The context reading and the outputs
 * list fold on their own headers, the reader's click the only state either
 * keeps.
 */

interface RailSection {
  section: HTMLElement
  toggle: HTMLButtonElement
  body: HTMLElement
}

interface RailRefs {
  root: HTMLElement
  toggle: HTMLButtonElement
  body: HTMLElement
  workspaceName: HTMLElement
  workspacePath: HTMLElement
  context: RailSection
  contextTitle: string
  percent: HTMLElement
  tokens: HTMLElement
  bar: HTMLElement
  fill: HTMLElement
  used: HTMLElement
  free: HTMLElement
  window: HTMLElement
  contextCells: HTMLElement[]
  legendValues: Map<string, HTMLElement>
  outputs: RailSection
  outputsTitle: string
  outputsList: HTMLElement
  outputsEmpty: HTMLElement
}

/** The part mark each element of the rail carries, so a lane reads the element it means without spelling a class name. */
function markPart<T extends HTMLElement>(element: T, part: string) {
  element.setAttribute(SESSION_RAIL_PART_ATTR, part)
  return element
}

/** One section whose header folds its body: the context reading and the outputs list. */
function buildFoldedSection(key: string, title: string): RailSection {
  const section = buildElement('section', 'dsh-claude-session-rail-section')
  section.setAttribute('data-dsh-claude-rail-section', key)
  const toggle = markPart(buildElement('button', 'dsh-claude-session-rail-section-toggle'), 'section-toggle')
  toggle.type = 'button'
  const titleText = buildElement('span', 'dsh-claude-session-rail-section-title', title)
  toggle.append(titleText, buildChevron('M4 6.5 8 10.5 12 6.5', 12))
  const body = markPart(buildElement('div', 'dsh-claude-session-rail-section-body'), 'section-body')
  section.append(toggle, body)
  return { section, toggle, body }
}

function buildRail(): RailRefs {
  const root = markPart(buildElement('aside', 'dsh-claude-session-rail'), 'rail')
  root.setAttribute('aria-label', copy('railTitle'))
  const head = buildElement('div', 'dsh-claude-session-rail-head')
  const title = buildElement('span', 'dsh-claude-session-rail-title', copy('railTitle'))
  const toggle = markPart(buildElement('button', 'dsh-claude-session-rail-toggle'), 'toggle')
  toggle.type = 'button'
  toggle.append(buildChevron('M6 3.5 10.5 8 6 12.5', 14))
  head.append(title, toggle)

  const body = markPart(buildElement('div', 'dsh-claude-session-rail-body'), 'body')

  // The environment stays as it stands: it is one row, and folding it would
  // hide the only line that says where the session runs.
  const environment = buildElement('section', 'dsh-claude-session-rail-section')
  environment.setAttribute('data-dsh-claude-rail-section', 'environment')
  const environmentTitle = buildElement('h2', 'dsh-claude-session-rail-section-title', copy('railEnvironment'))
  const workspace = buildElement('div', 'dsh-claude-session-rail-workspace')
  const workspaceName = markPart(buildElement('span', 'dsh-claude-session-rail-workspace-name'), 'workspace-name')
  const workspacePath = markPart(buildElement('span', 'dsh-claude-session-rail-workspace-path'), 'workspace-path')
  workspace.append(workspaceName, workspacePath)
  environment.append(environmentTitle, workspace)

  const contextTitle = copy('railContext')
  const context = buildFoldedSection('context', contextTitle)
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
  // The matrix: one cell per fortieth of the window, coloured by the kind of
  // token that fills it (session-rail.css reads the cell's own key), so the
  // section says what the window holds, not only how much of it.
  const matrix = markPart(buildElement('div', 'dsh-claude-session-rail-matrix'), 'context-matrix')
  matrix.setAttribute('role', 'img')
  matrix.setAttribute('aria-label', copy('railMatrixLabel'))
  const contextCells: HTMLElement[] = []
  for (let at = 0; at < RAIL_MATRIX_COLUMNS * RAIL_MATRIX_ROWS; at += 1) {
    const cell = markPart(buildElement('span', 'dsh-claude-session-rail-cell'), 'context-cell')
    cell.setAttribute(SESSION_RAIL_CELL_ATTR, 'free')
    matrix.append(cell)
    contextCells.push(cell)
  }
  // The legend names each colour and the tokens it stands for.
  const legend = markPart(buildElement('dl', 'dsh-claude-session-rail-legend'), 'context-legend')
  const legendValues = new Map<string, HTMLElement>()
  for (const [key, label] of [['system', copy('railSystem')], ['tools', copy('railTools')], ['conversation', copy('railConversation')], ['free', copy('railFree')]] as const) {
    const item = buildElement('div', 'dsh-claude-session-rail-legend-item')
    item.setAttribute(SESSION_RAIL_LEGEND_ATTR, key)
    const swatch = buildElement('span', 'dsh-claude-session-rail-legend-swatch')
    const term = buildElement('dt', 'dsh-claude-session-rail-legend-label', label)
    const value = buildElement('dd', 'dsh-claude-session-rail-legend-value', copy('railUnknown'))
    item.append(swatch, term, value)
    legend.append(item)
    legendValues.set(key, value)
  }
  context.body.append(reading, bar, rows, matrix, legend)

  const outputsTitle = copy('railOutputs')
  const outputs = buildFoldedSection('outputs', outputsTitle)
  // The section keeps its own fold: the reader's click is the only state either
  // section carries, and the next rail remembers it in this instance alone.
  const outputsList = buildElement('div', 'dsh-claude-session-rail-outputs')
  const outputsEmpty = markPart(buildElement('span', 'dsh-claude-session-rail-outputs-empty', copy('railNoOutputs')), 'outputs-empty')
  outputs.body.append(outputsList, outputsEmpty)

  body.append(environment, context.section, outputs.section)
  root.append(head, body)

  return {
    root,
    toggle,
    body,
    workspaceName,
    workspacePath,
    context,
    contextTitle,
    percent,
    tokens,
    bar,
    fill,
    used,
    free,
    window,
    contextCells,
    legendValues,
    outputs,
    outputsTitle,
    outputsList,
    outputsEmpty,
  }
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
  /** Whether each folded section stands open; the reader's clicks move these. */
  const sectionOpen = new Map<HTMLElement, boolean>()

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
  /** The session feed the outputs list follows, and the entries it has folded so far. */
  let outputSession: string | null = null
  let outputOff: (() => void) | null = null
  let outputs: RailOutput[] = []
  /** The outputs list drawn last, so an unchanged list is not rebuilt on every read. */
  let outputSignature = ''

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

  /**
   * Follow the shown session's own feed and fold its presentations into the
   * outputs list. A replace hands the window the host loaded; an append hands
   * the entries that arrived, so a session's earlier deliveries stay listed
   * after the live ones join. A binding that is not up yet leaves the session
   * unbound, and the next write tries again.
   */
  function followOutputs() {
    const sessionId = currentSessionId(ctx)
    if (sessionId === outputSession) return
    outputOff?.()
    outputOff = null
    outputSession = sessionId
    outputs = []
    if (sessionId === null) {
      writeOutputs()
      return
    }
    const feed = hostSessions(ctx)?.binding(sessionId)?.eventSource ?? null
    if (feed === null || typeof feed.subscribe !== 'function') {
      outputSession = null
      writeOutputs()
      return
    }
    outputs = railOutputs(feed.getSnapshot().entries)
    writeOutputs()
    outputOff = feed.subscribe(() => {
      const latest = feed.getSnapshot()
      const change = latest.change
      if (change?.kind === 'replace') outputs = railOutputs(latest.entries)
      else if (change?.kind === 'append' && Array.isArray(change.entries)) outputs = railOutputsAfter(outputs, change.entries)
      else return
      schedule()
    })
  }

  /** Draw the outputs list: one row per delivered file, its name over the description it carried. */
  function writeOutputs() {
    const signature = outputs.map(output => `${output.path}\u0000${output.description}`).join('\u0001')
    if (signature !== outputSignature) {
      outputSignature = signature
      const rows = outputs.map((output) => {
        const row = markPart(buildElement('div', 'dsh-claude-session-rail-output'), 'output')
        row.title = output.path
        row.append(markPart(buildElement('span', 'dsh-claude-session-rail-output-name', output.name), 'output-name'))
        if (output.description !== '') row.append(markPart(buildElement('span', 'dsh-claude-session-rail-output-description', output.description), 'output-description'))
        return row
      })
      refs.outputsList.replaceChildren(...rows)
    }
    refs.outputsList.hidden = outputs.length === 0
    refs.outputsEmpty.hidden = outputs.length > 0
  }

  /** Fold one section to its header or stand it open again; the body carries the native hidden state. */
  function applySection(section: RailSection, title: string) {
    const open = sectionOpen.get(section.section) !== false
    section.body.hidden = !open
    setAttributeIfChanged(section.toggle, 'aria-expanded', open ? 'true' : 'false')
    const label = copy(open ? 'railFoldSection' : 'railUnfoldSection', { name: title })
    section.toggle.setAttribute('aria-label', label)
    section.toggle.title = label
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

  /** Write the reading, the environment and the outputs: the counts the host answers, its dashes where it answers none. */
  function write() {
    if (host === null) return
    followSources()
    followPressure()
    followOutputs()

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
    const breakdown = currentSession(ctx)?.projections?.faceOf('contextBreakdown')?.getSnapshot() as HostContextBreakdownProjection | null | undefined
    // The host prices the composition in a projection the client may not carry;
    // without it the matrix still says what it knows: the tokens the reading
    // holds are conversation, and the rest is free.
    const parts = railContextParts(reading.used, breakdown)
      ?? (reading.used === null || reading.used <= 0 ? null : { system: 0, tools: 0, conversation: reading.used })
    const cells = railMatrixCells(parts, reading.window)
    for (const [at, cell] of refs.contextCells.entries()) {
      const key = cells[at] ?? 'free'
      if (cell.getAttribute(SESSION_RAIL_CELL_ATTR) !== key) cell.setAttribute(SESSION_RAIL_CELL_ATTR, key)
    }
    const figures = {
      system: parts?.system ?? null,
      tools: parts?.tools ?? null,
      conversation: parts?.conversation ?? null,
      free: reading.free,
    }
    for (const [key, value] of Object.entries(figures)) {
      const target = refs.legendValues.get(key)
      if (target !== undefined) writeTextInPlace(target, value === null ? copy('railUnknown') : formatCompactTokens(value))
    }
    writeOutputs()
  }

  /** Take the rail out of the body it hangs in: the host keeps its own children and the prefs keep their values. */
  function detach() {
    pressureOff?.()
    pressureOff = null
    pressureSource = null
    pressureSession = null
    outputOff?.()
    outputOff = null
    outputSession = null
    outputs = []
    outputSignature = ''
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
    applySection(refs.context, refs.contextTitle)
    applySection(refs.outputs, refs.outputsTitle)
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

  for (const [section, title] of [[refs.context, refs.contextTitle], [refs.outputs, refs.outputsTitle]] as const) {
    section.toggle.addEventListener('click', () => {
      const open = sectionOpen.get(section.section) !== false
      sectionOpen.set(section.section, !open)
      applySection(section, title)
    })
  }

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
