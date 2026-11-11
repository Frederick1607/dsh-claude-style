import { RIGHTBAR_COLLAPSED_ATTRIBUTE, SIDEBAR_BESIDE_RIGHTBAR_MIN_PX, SIDEBAR_COLLAPSED_ATTRIBUTE, SIDEBAR_DRAWER_ATTRIBUTE, SIDEBAR_OPENER_SELECTOR, WINDOWS_MENU_START_PROPERTY } from '@dsh-claude-ui/contracts/dom'
import { observeMatches, subscribeMutations } from '@dsh-claude-ui/engine/bus'
import { findForeground, findSidebarOpenControl, findSidebarRoot, hostLayout } from '@dsh-claude-ui/engine/host'
import type { HostContext } from '@dsh-claude-ui/engine/host'
import { FRAME_LEADING_CLEARANCE_PROPERTY, MOTION_ATTR, MOTION_REDUCED, SIDEBAR_PEEK_ATTR, SIDEBAR_PEEK_CLOSING, SIDEBAR_PEEK_OPEN, SIDEBAR_PEEK_RAIL_PROPERTY, SIDEBAR_PEEK_STAND_ATTR, SIDEBAR_PEEK_WIDTH_PROPERTY } from '../../constants'
import { motionMs } from '../../shared/motion'
import { FRAME_SELECTOR } from '../../shared/page-scale-columns'

/**
 * The collapsed sidebar opened over the page while the pointer rests on its
 * toggle, the way Claude's app peeks it (D43).
 *
 * The host draws the session list only while its own layout has the sidebar
 * open, so the peek opens it through the host's layout service and keeps the
 * page from making room: the column stands over the centre, and the centre
 * takes the open sidebar's track back, clear of the collapsed width it stood at
 * (sidebar-peek.css). Leaving the toggle and the column, or picking a session, a
 * new session or a panel in it, closes it the same way; a press on the toggle
 * while the sidebar stands keeps it open as the press always has, and the page
 * then makes room as usual.
 *
 * The button under the pointer is drawn by the peek itself, not swapped by the
 * host. Opening the sidebar replaces the host's opener with the column's own
 * toggle, and closing it swaps them back: two buttons in two boxes, and whatever
 * the host mounts in between leaves the box under the pointer empty for a frame
 * — the reader sees the button blink. So the peek copies the control it found
 * into a fixed box of its own (the copy carries none of the skin's marks, so no
 * rule of ours reads it as the host's control), keeps that copy standing from
 * the hover through the close, and hides the host's own toggle while the layer
 * stands. The copy leaves in the same task that shows the host's toggle again,
 * so the box is never empty: a copy removed earlier is the blink.
 *
 * A narrow layout may already stand the collapsed column out of the frame's own
 * flow as a drawer, holding its own room and dimming the page behind a backdrop
 * of its own. That layout keeps the sidebar to itself: the peek's overlay and
 * its layer would stand under that backdrop and take the drawer down with them,
 * so the peek stands down there.
 */

/** How long the pointer rests on the toggle before the sidebar opens: a pointer passing over on its way to the caption row opens nothing. */
const OPEN_DELAY_MS = 120
/** How long the pointer may stand outside the toggle and the column before the sidebar closes: the Windows caption strip between the two hands the pointer to the shell for a moment. */
const LEAVE_DELAY_MS = 300
/**
 * The frames the host's control must stand in the box before the copy steps
 * away, so a control the host is about to replace is not taken for the settled
 * one.
 */
const HANDOVER_STABLE_FRAMES = 5
/**
 * How long the copy stands over a box the host's control has left empty. The
 * host's own collapse unmounts the rail's toggle for a few frames and puts it
 * back; the copy covers exactly those frames. A control that never comes back
 * (the layout changed under the copy) ends it after this grace.
 */
const STAND_GRACE_MS = 800

/** A click on one of these in the open column leaves for another view, and the peek closes behind it; the row's own menu button stays inside. */
const NAVIGATION_SELECTOR = ':is([data-dsh-claude-part~="session-row"], [data-dsh-claude-part~="new-session"], [data-dsh-claude-part~="panel-row"])'
const ROW_ACTIONS_SELECTOR = '[data-dsh-claude-part~="row-actions"]'
const COLUMN_SELECTOR = ':scope > [data-dsh-claude-part~="sidebar-column"]'
const CENTER_SELECTOR = ':scope > [data-dsh-claude-part~="center-column"]'

/** The opener's mark, read off the selector the contract names it by: the copy stands without it, so no reader takes the copy for the control. */
const OPENER_ATTRIBUTE = SIDEBAR_OPENER_SELECTOR.slice(1, -1)

/** Every mark the skin writes on the host's elements: a copy carries them away, so no rule of the skin reads the copy as the host's own. */
const SKIN_MARK_PREFIX = 'data-dsh-claude-'

type Phase = 'idle' | 'waiting' | 'open' | 'closing'

interface Point {
  x: number
  y: number
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function within(box: DOMRect, point: Point) {
  return point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom
}

/** A field the reader is typing in: a rename or the search box keeps the column open. */
function editing(column: Element) {
  const active = document.activeElement
  if (active === null || !column.contains(active)) return false
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)
}

/** Take the skin's marks off a copy: the host's classes stay, the skin's own reading of the element goes. */
function stripSkinMarks(element: Element) {
  for (const attribute of [...element.attributes]) {
    if (attribute.name.startsWith(SKIN_MARK_PREFIX)) element.removeAttribute(attribute.name)
  }
  for (const child of element.children) stripSkinMarks(child)
}

export function install(ctx: HostContext) {
  const frames = observeMatches<HTMLElement>(FRAME_SELECTOR)
  let phase: Phase = 'idle'
  /** The frame the peek is open on. */
  let frame: HTMLElement | null = null
  /** Whether the host has opened the sidebar since the peek asked it to. */
  let opened = false
  let offFrame: (() => void) | null = null
  /** The inline value the document element carried before the peek held the menu's start, or null while nothing is held. */
  let menuBefore: string | null = null
  /** The frame's own inline leading clearance before the peek held it, or null while nothing is held. */
  let clearanceBefore: string | null = null
  let pointer: Point | null = null
  let openTimer: number | undefined
  let leaveTimer: number | undefined
  let closeTimer: number | undefined
  /** The copy of the control standing in the box under the pointer, the box it was placed in, and the watch that keeps it there. */
  let stand: HTMLElement | null = null
  let standBox: Box | null = null
  let offStandWatch: (() => void) | null = null
  /** When the host's control was first missed under the copy, or 0 while it stands. */
  let standMissedAt = 0


  const collapsed = (box: HTMLElement) => box.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)
  const column = () => frame?.querySelector<HTMLElement>(COLUMN_SELECTOR) ?? null

  /**
   * Whether the frame's own flow still holds the collapsed column: a drawer
   * stands out of it. The host states the drawer in a mark of its own, so the
   * mark answers first; a host build that writes none is read by the column's
   * own placement, which costs a layout to read.
   */
  function inFlow(box: HTMLElement) {
    if (box.hasAttribute(SIDEBAR_DRAWER_ATTRIBUTE)) return false
    const col = box.querySelector<HTMLElement>(COLUMN_SELECTOR)
    if (col === null) return true
    const position = getComputedStyle(col).position
    return position !== 'absolute' && position !== 'fixed'
  }

  /** Whether opening the sidebar here leaves the page as it stands: collapsed, in the frame's flow, and with any right panel kept beside it. */
  function canOpen(box: HTMLElement) {
    if (!collapsed(box) || !inFlow(box)) return false
    return box.hasAttribute(RIGHTBAR_COLLAPSED_ATTRIBUTE) || box.getBoundingClientRect().width >= SIDEBAR_BESIDE_RIGHTBAR_MIN_PX
  }

  /** The width the slide travels: the one the host gives the open sidebar's own box. */
  function writeWidth() {
    if (frame === null) return
    const width = findSidebarRoot()?.style.getPropertyValue('width') ?? ''
    if (width !== '' && frame.style.getPropertyValue(SIDEBAR_PEEK_WIDTH_PROPERTY) !== width) frame.style.setProperty(SIDEBAR_PEEK_WIDTH_PROPERTY, width)
  }

  /**
   * The Windows caption row places its menu from a property the host declares
   * only while the frame is collapsed; held at that value, the menu stays where
   * it stood while the sidebar is open over the page.
   */
  function holdMenuStart() {
    const root = document.documentElement
    const value = getComputedStyle(root).getPropertyValue(WINDOWS_MENU_START_PROPERTY).trim()
    if (value === '') return
    menuBefore = root.style.getPropertyValue(WINDOWS_MENU_START_PROPERTY)
    root.style.setProperty(WINDOWS_MENU_START_PROPERTY, value)
  }

  function releaseMenuStart() {
    if (menuBefore === null) return
    const root = document.documentElement
    if (menuBefore === '') root.style.removeProperty(WINDOWS_MENU_START_PROPERTY)
    else root.style.setProperty(WINDOWS_MENU_START_PROPERTY, menuBefore)
    menuBefore = null
  }

  /**
   * The desktop frame pads the conversation's title row by the collapsed
   * column's clearance (the host's own property while the column stands
   * hidden). Opening the column drops that padding and slides the title and
   * the controls beside it, so the peek holds the value it opened with: a
   * hover moves nothing but the layer.
   */
  function holdClearance(box: HTMLElement) {
    const value = getComputedStyle(box).getPropertyValue(FRAME_LEADING_CLEARANCE_PROPERTY).trim()
    if (value === '') return
    clearanceBefore = box.style.getPropertyValue(FRAME_LEADING_CLEARANCE_PROPERTY)
    box.style.setProperty(FRAME_LEADING_CLEARANCE_PROPERTY, value)
  }

  function releaseClearance(box: HTMLElement) {
    if (clearanceBefore === null) return
    if (clearanceBefore === '') box.style.removeProperty(FRAME_LEADING_CLEARANCE_PROPERTY)
    else box.style.setProperty(FRAME_LEADING_CLEARANCE_PROPERTY, clearanceBefore)
    clearanceBefore = null
  }

  function clearTimers() {
    window.clearTimeout(openTimer)
    window.clearTimeout(leaveTimer)
    window.clearTimeout(closeTimer)
    openTimer = undefined
    leaveTimer = undefined
    closeTimer = undefined
  }

  /** Place the copy in the box the control kept when the box is known. */
  function placeStand() {
    if (stand === null || standBox === null) return
    const control = findSidebarOpenControl()
    const box = control === null ? standBox : control.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) return
    stand.style.left = `${box.left}px`
    stand.style.top = `${box.top}px`
    stand.style.width = `${box.width}px`
    stand.style.height = `${box.height}px`
  }

  /**
   * Stand a copy of the control in its own fixed box: the button the reader
   * sees from the hover through the close. The copy answers a press as the
   * control does, and carries no skin mark, so no rule of the skin's reads it as
   * the host's toggle.
   *
   * @param control - the host's own control, found under the pointer.
   */
  function mountStand(control: HTMLElement) {
    unmountStand()
    const box = control.getBoundingClientRect()
    const copy = control.cloneNode(true) as HTMLElement
    stripSkinMarks(copy)
    copy.removeAttribute(OPENER_ATTRIBUTE)
    copy.setAttribute(SIDEBAR_PEEK_STAND_ATTR, '')
    copy.setAttribute('tabindex', '-1')
    copy.style.position = 'fixed'
    copy.style.left = `${box.left}px`
    copy.style.top = `${box.top}px`
    copy.style.width = `${box.width}px`
    copy.style.height = `${box.height}px`
    copy.style.margin = '0'
    copy.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      press()
    })
    document.body.append(copy)
    stand = copy
    standBox = { left: box.left, top: box.top, width: box.width, height: box.height }
    offStandWatch?.()
    offStandWatch = subscribeMutations(document.body, { attributes: true, childList: true, subtree: true }, watchStand)
  }

  function unmountStand() {
    offStandWatch?.()
    offStandWatch = null
    standMissedAt = 0
    stand?.remove()
    stand = null
    standBox = null
  }

  /**
   * Watch the host's control while the copy stands: the copy keeps the box the
   * control stands in, so a host render that moves or unmounts the control moves
   * or takes the copy with it, and a control that is gone ends the copy. A frame
   * of the host's own re-render is exactly the blink the copy is here to cover.
   */
  function watchStand() {
    if (stand === null) return
    const control = findSidebarOpenControl()
    if (control === null || !control.isConnected) {
      if (standMissedAt === 0) standMissedAt = Date.now()
      else if (Date.now() - standMissedAt > STAND_GRACE_MS) unmountStand()
      return
    }
    standMissedAt = 0
  }

  /** Whether a node is the control the pointer rests on: the host's own toggle, or the copy standing in its box. */
  function holds(node: EventTarget | null | undefined) {
    if (!(node instanceof Node)) return false
    const control = findSidebarOpenControl()
    return (control !== null && control.contains(node)) || (stand !== null && stand.contains(node))
  }

  /** Give the frame back to the host: its own columns, its own caption row, its own control. */
  function finish() {
    clearTimers()
    if (offFrame !== null) offFrame()
    offFrame = null
    if (frame !== null) {
      frame.removeAttribute(SIDEBAR_PEEK_ATTR)
      frame.style.removeProperty(SIDEBAR_PEEK_RAIL_PROPERTY)
      frame.style.removeProperty(SIDEBAR_PEEK_WIDTH_PROPERTY)
      releaseClearance(frame)
    }
    releaseMenuStart()
    frame = null
    opened = false
    phase = 'idle'
    // The copy stays: it is what the reader saw a moment ago, and it is what the
    // host's own control is once the host has painted it again (see the stand's
    // watch below). Removing it here is the blink.
  }

  function onFrameChange() {
    if (frame === null) return
    if (!collapsed(frame)) {
      opened = true
      writeWidth()
      return
    }
    // The marker is back: the peek's own close, or the host closing the
    // sidebar itself (its shortcut, a width crossing its breakpoint). The first
    // records can still predate the host's own render of the open sidebar.
    if (opened) finish()
  }

  function open() {
    openTimer = undefined
    const box = frames.all()[0] ?? null
    if (phase !== 'waiting' || box === null || !canOpen(box)) {
      phase = 'idle'
      unmountStand()
      return
    }
    // Where the centre starts while the column is collapsed, in the frame's own
    // pixels: zero beside the desktop's hidden column, the rail's width on the
    // web. The column's own box reads wider by the border it hangs past its track.
    const center = box.querySelector<HTMLElement>(CENTER_SELECTOR)
    if (center === null) {
      phase = 'idle'
      unmountStand()
      return
    }
    frame = box
    phase = 'open'
    holdMenuStart()
    holdClearance(box)
    box.style.setProperty(SIDEBAR_PEEK_RAIL_PROPERTY, `${center.offsetLeft}px`)
    box.setAttribute(SIDEBAR_PEEK_ATTR, SIDEBAR_PEEK_OPEN)
    offFrame = subscribeMutations(box, { attributes: true, attributeFilter: [SIDEBAR_COLLAPSED_ATTRIBUTE] }, onFrameChange)
    hostLayout(ctx).toggleSidebar()
  }

  function close() {
    if (phase !== 'open' || frame === null) return
    window.clearTimeout(leaveTimer)
    leaveTimer = undefined
    phase = 'closing'
    frame.setAttribute(SIDEBAR_PEEK_ATTR, SIDEBAR_PEEK_CLOSING)
    const wait = document.body.getAttribute(MOTION_ATTR) === MOTION_REDUCED ? 0 : motionMs('--dsh-claude-duration-exit')
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined
      if (phase !== 'closing' || frame === null) return
      if (collapsed(frame)) finish()
      else hostLayout(ctx).toggleSidebar()
    }, wait)
  }

  /** Keep the sidebar open: the column goes back into the grid and the page makes room, as a press on the toggle always does. */
  function pin() {
    clearTimers()
    if (frame === null) {
      phase = 'idle'
      unmountStand()
      return
    }
    if (collapsed(frame)) hostLayout(ctx).toggleSidebar()
    finish()
  }

  /** A press on the copy: before the peek opens it opens and keeps the sidebar, while it stands it keeps it. */
  function press() {
    if (phase === 'open' || phase === 'closing') {
      pin()
      return
    }
    if (phase === 'waiting') {
      window.clearTimeout(openTimer)
      openTimer = undefined
      pin()
      return
    }
    // Nothing is open and the copy is a picture again: the press belongs to the
    // host's control, which may be standing under the copy.
    findSidebarOpenControl()?.click()
  }

  function inside() {
    if (pointer === null) return false
    if (stand !== null && within(stand.getBoundingClientRect(), pointer)) return true
    const toggle = findSidebarOpenControl()
    if (toggle !== null && within(toggle.getBoundingClientRect(), pointer)) return true
    const box = column()
    return box !== null && within(box.getBoundingClientRect(), pointer)
  }

  /** A menu the column opened, a field being typed in or a drag in progress keeps it open wherever the pointer stands. */
  function held(pressed: boolean) {
    if (pressed || findForeground() !== null) return true
    const box = column()
    return box !== null && editing(box)
  }

  function judge(pressed: boolean) {
    if (phase !== 'open') return
    if (inside() || held(pressed)) {
      window.clearTimeout(leaveTimer)
      leaveTimer = undefined
      return
    }
    if (leaveTimer !== undefined) return
    leaveTimer = window.setTimeout(() => {
      leaveTimer = undefined
      if (!inside() && !held(false)) close()
    }, LEAVE_DELAY_MS)
  }

  function onPointerOver(event: PointerEvent) {
    if (phase !== 'idle') return
    if (!holds(event.target)) return
    const box = frames.all()[0] ?? null
    if (box === null || !canOpen(box)) return
    const control = findSidebarOpenControl()
    if (control === null) return
    if (stand === null) mountStand(control)
    phase = 'waiting'
    openTimer = window.setTimeout(open, OPEN_DELAY_MS)
  }

  function onPointerOut(event: PointerEvent) {
    // Off the window, or onto the Windows caption strip the shell keeps for itself.
    if (event.relatedTarget === null) {
      pointer = null
      judge(false)
    }
    if (phase !== 'waiting') return
    if (holds(event.relatedTarget)) return
    // Leaving the box before it opened: the copy steps back at once, in the
    // same task that shows the host's own toggle again.
    window.clearTimeout(openTimer)
    openTimer = undefined
    phase = 'idle'
    unmountStand()
  }

  function onPointerMove(event: PointerEvent) {
    pointer = { x: event.clientX, y: event.clientY }
    judge(event.buttons !== 0)
  }

  /** Before the host hears it: a press on the toggle while the sidebar stands over the page keeps it open. */
  function onClickCapture(event: MouseEvent) {
    if (!holds(event.target)) return
    if (phase === 'waiting') {
      window.clearTimeout(openTimer)
      openTimer = undefined
      event.stopPropagation()
      event.preventDefault()
      pin()
      return
    }
    if (phase !== 'open' && phase !== 'closing') return
    if (frame === null || collapsed(frame)) return
    event.stopPropagation()
    event.preventDefault()
    pin()
  }

  /** After the host has acted on it: a click that left for another view closes the peek. */
  function onClick(event: MouseEvent) {
    if (phase !== 'open' || !(event.target instanceof Element)) return
    const box = column()
    if (box === null || !box.contains(event.target)) return
    if (event.target.closest(NAVIGATION_SELECTOR) === null || event.target.closest(ROW_ACTIONS_SELECTOR) !== null) return
    close()
  }

  const onResize = () => placeStand()

  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('pointerout', onPointerOut, true)
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('click', onClick)
  window.addEventListener('resize', onResize)

  return () => {
    document.removeEventListener('pointerover', onPointerOver, true)
    document.removeEventListener('pointerout', onPointerOut, true)
    document.removeEventListener('pointermove', onPointerMove, { capture: true })
    document.removeEventListener('click', onClickCapture, true)
    document.removeEventListener('click', onClick)
    window.removeEventListener('resize', onResize)
    // The switch turned off while the sidebar stood over the page: it goes back
    // the way it came, so the page is left as the reader had it.
    if ((phase === 'open' || phase === 'closing') && frame !== null && !collapsed(frame)) hostLayout(ctx).toggleSidebar()
    finish()
    frames.release()
  }
}
