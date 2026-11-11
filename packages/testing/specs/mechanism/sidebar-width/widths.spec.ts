/**
 * The sidebar's width is one host number: the open width, and `0` for closed.
 * The host's toggle opens at its default every time, so the width a reader
 * dragged to is dropped by the close. The feature remembers that width and puts
 * it back on the next open (packages/client/src/features/sidebar-width/); these
 * tests hold what counts as a remembered width and when an open needs it back.
 *
 * @capability sidebar-width
 * @features sidebar-width
 * @risk A width outside the drag's range stands the sidebar at a box the host never draws, and a restore that fires on every open fights a reader who is widening it right now.
 */
import { expect, test } from 'vitest'
import { rememberedWidth, restoredWidth } from '@dsh-claude-ui/client/pure'

test('a remembered width is one the host drag could have left, the default included', () => {
  expect(rememberedWidth(264)).toBe(264)
  expect(rememberedWidth(280)).toBe(280)
  expect(rememberedWidth(420)).toBe(420)
  expect(rememberedWidth(320.4)).toBe(320)
})

test('a closed sidebar, a broken value and a width outside the drag range remember nothing', () => {
  expect(rememberedWidth(0)).toBeNull()
  expect(rememberedWidth(263)).toBeNull()
  expect(rememberedWidth(421)).toBeNull()
  expect(rememberedWidth(Number.NaN)).toBeNull()
  expect(rememberedWidth(null)).toBeNull()
})

test('the open takes the remembered width back only when it stands elsewhere', () => {
  expect(restoredWidth(280, 316)).toBe(316)
  expect(restoredWidth(316, 316)).toBeNull()
  expect(restoredWidth(280, null)).toBeNull()
})

test('a default open with no remembered width is left as the host drew it', () => {
  expect(restoredWidth(280, rememberedWidth(0))).toBeNull()
})
