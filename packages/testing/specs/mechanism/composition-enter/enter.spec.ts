/**
 * The Enter that a composition that just ended still owns: Safari and Electron on
 * macOS can deliver the throw of a candidate with `isComposing` already false, so
 * the host's own flag misses it and the draft would be sent while the reader is
 * still choosing the word. The hold runs on the composition's own timestamp and
 * closes at its constant; Firefox on macOS and every page off the Apple WebKit
 * engine keep the Enter, and so does a Shift+Enter newline.
 *
 * @capability composition-enter
 * @features composer
 * @risk A reader confirming a Chinese or Japanese candidate presses Enter and the half-written prompt is sent before the candidate is in the draft, so the message carries the wrong words.
 */
import { expect, test } from 'vitest'
import { IME_COMMIT_WINDOW_MS, swallowsCompositionEnter } from '@dsh-claude-style/client/pure'

/** The agent Safari on macOS sends. */
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
/** The agent Electron on macOS sends, whose Chromium on macOS reaches the same race. */
const ELECTRON_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36'
/** The agent Firefox on macOS sends: the same platform, a different engine. */
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0'
/** The agent Chrome sends on Windows: the same engine token, another platform. */
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** A keydown as the hold reads it, an untouched Enter by default. */
function enter(overrides: Partial<{ key: string, shiftKey: boolean, altKey: boolean, ctrlKey: boolean, metaKey: boolean }> = {}) {
  return { key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...overrides }
}

test('Enter 300ms after the composition ends is held', () => {
  expect(swallowsCompositionEnter({ key: enter(), endedAt: 1000, now: 1300, userAgent: SAFARI_MAC })).toBe(true)
})

test('Enter one second after the composition ends reaches the host', () => {
  expect(swallowsCompositionEnter({ key: enter(), endedAt: 1000, now: 2000, userAgent: SAFARI_MAC })).toBe(false)
})

test('the window closes at its constant', () => {
  expect(swallowsCompositionEnter({ key: enter(), endedAt: 1000, now: 1000 + IME_COMMIT_WINDOW_MS - 1, userAgent: SAFARI_MAC })).toBe(true)
  expect(swallowsCompositionEnter({ key: enter(), endedAt: 1000, now: 1000 + IME_COMMIT_WINDOW_MS, userAgent: SAFARI_MAC })).toBe(false)
})

test('the hold belongs to Apple WebKit on macOS alone', () => {
  expect(swallowsCompositionEnter({ key: enter(), endedAt: 1000, now: 1300, userAgent: ELECTRON_MAC })).toBe(true)
  expect(swallowsCompositionEnter({ key: enter(), endedAt: 1000, now: 1300, userAgent: FIREFOX_MAC })).toBe(false)
  expect(swallowsCompositionEnter({ key: enter(), endedAt: 1000, now: 1300, userAgent: CHROME_WINDOWS })).toBe(false)
})

test('a newline and every other key are never held', () => {
  expect(swallowsCompositionEnter({ key: enter({ shiftKey: true }), endedAt: 1000, now: 1300, userAgent: SAFARI_MAC })).toBe(false)
  expect(swallowsCompositionEnter({ key: enter({ altKey: true }), endedAt: 1000, now: 1300, userAgent: SAFARI_MAC })).toBe(false)
  expect(swallowsCompositionEnter({ key: enter({ ctrlKey: true }), endedAt: 1000, now: 1300, userAgent: SAFARI_MAC })).toBe(false)
  expect(swallowsCompositionEnter({ key: enter({ metaKey: true }), endedAt: 1000, now: 1300, userAgent: SAFARI_MAC })).toBe(false)
  expect(swallowsCompositionEnter({ key: enter({ key: 'a' }), endedAt: 1000, now: 1300, userAgent: SAFARI_MAC })).toBe(false)
  expect(swallowsCompositionEnter({ key: enter({ key: 'Enter' }), endedAt: 1000, now: 1300, userAgent: SAFARI_MAC })).toBe(true)
})

test('an Enter before any composition ends is never held', () => {
  expect(swallowsCompositionEnter({ key: enter(), endedAt: null, now: 1300, userAgent: SAFARI_MAC })).toBe(false)
})
