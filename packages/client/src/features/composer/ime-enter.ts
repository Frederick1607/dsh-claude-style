/**
 * The Enter that a composition just ended still owns. Safari and Electron on
 * macOS can deliver the Enter that confirms a candidate with `isComposing`
 * already false, so the host's own flag misses it and the draft would be sent
 * while the reader is still choosing the word; the guard keeps the composition's
 * own timestamp instead (the reference implementation,
 * `RichComposerWithMentions.tsx`, answers the same 500ms race).
 *
 * The hold is decided here, without the DOM, so the window and the engine rule
 * are judged on their own (packages/testing/specs/mechanism).
 */

/** How long after `compositionend` an Enter still belongs to that commit. */
export const IME_COMMIT_WINDOW_MS = 500

/**
 * Whether the page runs the engine the post-composition Enter escapes from:
 * Apple WebKit on macOS, which is Safari and Electron there. Firefox on macOS
 * sends no `AppleWebKit` token, so it never matches; Windows and Linux pages are
 * out on the platform.
 *
 * @param userAgent - the page's own agent string, read by the installer.
 */
export function isAppleWebKitOnMac(userAgent: string): boolean {
  return /Macintosh|Mac OS X/.test(userAgent) && /AppleWebKit\//.test(userAgent)
}

/** The key facts of a keydown, as the hold reads them. */
export interface EnterKey {
  key: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/** One keydown against the page's last composition. */
export interface CompositionEnter {
  /** The keydown, as the event spells it. */
  key: EnterKey
  /** When the last `compositionend` ran, or null when none has on this page. */
  endedAt: number | null
  /** The clock reading of the keydown. */
  now: number
  /** The page's agent string. */
  userAgent: string
}

/**
 * Whether the guard holds this Enter: the key is the one a submission takes, the
 * last composition ended less than the window ago, and the page runs the engine
 * that gets the flag wrong. A newline and every other key are never held, so a
 * reader keeps the words they were typing.
 *
 * @param input - the keydown, the composition's end and the page's clock.
 * @returns whether the installer should cancel the Enter before the host's
 *   submission sees it.
 */
export function swallowsCompositionEnter(input: CompositionEnter): boolean {
  if (input.key.key !== 'Enter') return false
  if (input.key.shiftKey || input.key.altKey || input.key.ctrlKey || input.key.metaKey) return false
  if (input.endedAt === null) return false
  if (input.now - input.endedAt >= IME_COMMIT_WINDOW_MS) return false
  return isAppleWebKitOnMac(input.userAgent)
}
