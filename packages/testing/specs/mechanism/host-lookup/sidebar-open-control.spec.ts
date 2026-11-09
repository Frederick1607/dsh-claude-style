/**
 * The control a reader points at to open the collapsed sidebar is one of two
 * host buttons: the desktop hides the collapsed column and mounts its opener in
 * the frame's leading seat, while the web stands the column in its rail and
 * leaves the toggle inside it (D3). The skin reads whichever one draws.
 *
 * @capability host-lookup
 * @features engine, sidebar-peek
 * @risk On the desktop the pointer rests on the leading-seat opener while the skin listens on the column's hidden toggle, so hovering to open the sidebar does nothing.
 */
import { afterEach, expect, test } from 'vitest'
import { findSidebarOpenControl } from '@dsh-claude-style/engine/host'
import { SIDEBAR_OPENER_SELECTOR, SIDEBAR_TOGGLE_SELECTOR } from '@dsh-claude-style/contracts/dom'
import { hostElement } from '../../fixtures/host-markup'

/** A batch of mutations is delivered on the microtask queue, which is where a missing seat is read again. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  document.body.replaceChildren()
})

/** The column's own toggle: the contract's selector is two compounds, one inside the other. */
function columnToggle() {
  const [slotSelector, toggleSelector] = SIDEBAR_TOGGLE_SELECTOR.split(' ')
  const column = hostElement(slotSelector)
  const toggle = hostElement(toggleSelector)
  column.append(toggle)
  return { column, toggle }
}

test('the leading-seat opener answers while it draws', async () => {
  const { column, toggle } = columnToggle()
  const opener = hostElement(SIDEBAR_OPENER_SELECTOR)
  document.body.append(column, opener)
  await settle()
  expect(findSidebarOpenControl()).toBe(opener)
  expect(toggle.isConnected).toBe(true)
})

test('the column toggle answers while no opener draws', async () => {
  const { column, toggle } = columnToggle()
  document.body.append(column)
  await settle()
  expect(findSidebarOpenControl()).toBe(toggle)
})

test('an opener kept mounted but hidden hands the pointer to the column toggle', async () => {
  const { column, toggle } = columnToggle()
  const opener = hostElement(SIDEBAR_OPENER_SELECTOR)
  opener.style.display = 'none'
  document.body.append(column, opener)
  await settle()
  expect(findSidebarOpenControl()).toBe(toggle)
})
