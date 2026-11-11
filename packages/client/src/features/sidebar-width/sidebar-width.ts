import { SIDEBAR_COLLAPSED_ATTRIBUTE } from '@dsh-claude-ui/contracts/dom'
import { observeMatches, subscribeMutations } from '@dsh-claude-ui/engine/bus'
import { requestFrame } from '@dsh-claude-ui/engine/frame'
import { findSidebarRoot, hostLayout } from '@dsh-claude-ui/engine/host'
import type { HostContext } from '@dsh-claude-ui/engine/host'
import { FRAME_SELECTOR } from '../../shared/page-scale-columns'
import { rememberedWidth, restoredWidth } from './widths'

/**
 * The sidebar's width, kept across a close (sidebar-width.ts).
 *
 * The host's layout keeps one number for the sidebar: its open width, and `0`
 * for closed. Its own toggle opens at the default width every time, so a reader
 * who narrows the sidebar finds it wide again on the next open — the width was
 * dropped with the close. The feature remembers the width the reader dragged to
 * (the host writes it to the sidebar's own box) and puts it back on the next
 * open, once, without touching a width that already stands where they left it.
 */

/** Where the reader's own width is kept: the skin's own key, beside the page they read. */
const STORAGE_KEY = 'dsh-claude-ui/sidebar-width'

/** The layout service: the store the host's own drag writes. */
interface LayoutService {
  setSidebar?: (px: number) => void
}

function readStored(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? null : rememberedWidth(Number(raw))
  } catch {
    return null
  }
}

function store(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // An unavailable store keeps the width for this page only, which is the
    // host's own behaviour.
  }
}

/** The width the sidebar's box stands at, in whole pixels. */
function standingWidth() {
  const root = findSidebarRoot()
  if (root === null) return null
  const width = root.getBoundingClientRect().width
  return width > 0 ? Math.round(width) : null
}

export function install(ctx: HostContext) {
  const frames = observeMatches<HTMLElement>(FRAME_SELECTOR, () => {
    const box = frames.all()[0] ?? null
    if (box !== null) watch(box)
  })
  let frame: HTMLElement | null = null
  let offFrame: (() => void) | null = null
  let offRoot: (() => void) | null = null
  let queued: (() => void) | null = null
  let released = false

  /** The width the host opened this frame with, so one open corrects once. */
  let corrected = false

  const collapsed = (box: HTMLElement) => box.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE)

  /** Put the reader's own width back after the host opened at its default. */
  function correct() {
    queued = null
    if (released || frame === null) return
    if (corrected) return
    corrected = true
    const layout = hostLayout(ctx) as LayoutService | null | undefined
    if (typeof layout?.setSidebar !== 'function') return
    const current = standingWidth()
    if (current === null) return
    const width = restoredWidth(current, readStored())
    if (width === null) return
    layout.setSidebar(width)
  }

  /** Keep the width the sidebar stands at while it is open. */
  function remember() {
    if (frame === null || collapsed(frame)) return
    const width = standingWidth()
    if (width === null) return
    if (readStored() === width) return
    store(width)
  }

  function scheduleCorrect() {
    if (queued !== null) return
    queued = requestFrame({ write: correct })
  }

  function watch(box: HTMLElement) {
    if (frame !== null && frame !== box) releaseFrame()
    if (frame === box) return
    frame = box
    corrected = false
    offFrame = subscribeMutations(box, { attributes: true, attributeFilter: [SIDEBAR_COLLAPSED_ATTRIBUTE] }, () => {
      if (frame === null) return
      if (collapsed(frame)) {
        corrected = false
        remember()
        return
      }
      scheduleCorrect()
    })
    const root = findSidebarRoot()
    if (root !== null) {
      offRoot = subscribeMutations(root, { attributes: true, attributeFilter: ['style'] }, remember)
    }
    if (!collapsed(box)) scheduleCorrect()
  }

  function releaseFrame() {
    offFrame?.()
    offFrame = null
    offRoot?.()
    offRoot = null
    frame = null
  }

  const box = frames.all()[0] ?? null
  if (box !== null) watch(box)

  return () => {
    released = true
    if (queued !== null) queued()
    queued = null
    releaseFrame()
    frames.release()
  }
}
