import { COMPOSER_INPUT_SELECTOR } from '@dsh-claude-style/contracts/dom'
import { swallowsCompositionEnter } from './ime-enter'

/**
 * Hold the Enter that a composition just ended still owns (ime-enter.ts): the
 * capture pass sees the keydown before the draft and its submission do, cancels
 * the newline and stops the event, so the host's own handler never runs for it.
 * Only the composer's draft is guarded and only for Enter, so the words of a
 * candidate can still be confirmed and a Shift+Enter newline still reaches the
 * host.
 *
 * @returns the teardown, safe to run twice.
 */
export function installCompositionEnterGuard(): () => void {
  /** When the last composition ended in a composer draft, or null before one does. */
  let endedAt: number | null = null

  const onCompositionEnd = (event: CompositionEvent) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest(COMPOSER_INPUT_SELECTOR) === null) return
    endedAt = Date.now()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest(COMPOSER_INPUT_SELECTOR) === null) return
    const held = swallowsCompositionEnter({
      key: {
        key: event.key,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      },
      endedAt,
      now: Date.now(),
      userAgent: navigator.userAgent,
    })
    if (!held) return
    event.preventDefault()
    event.stopPropagation()
  }

  document.addEventListener('compositionend', onCompositionEnd, true)
  document.addEventListener('keydown', onKeyDown, true)
  return () => {
    document.removeEventListener('compositionend', onCompositionEnd, true)
    document.removeEventListener('keydown', onKeyDown, true)
  }
}
