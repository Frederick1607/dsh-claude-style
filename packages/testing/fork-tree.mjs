#!/usr/bin/env node
/**
 * fork-tree.mjs — a forked session standing indented under its source (D87).
 *
 * Registered in the lane's scenario table (packages/testing/scenarios.mjs).
 *
 * The host keeps no parent field for an ordinary fork: the client controller
 * renames the child to the source's title with its counter moved on, and the
 * skin reads that title (packages/client/src/features/fork-tree/). The scenario
 * forks the shown session through the sidebar's own row menu, then reads the
 * rows the skin marked: the source with its fold, the child directly behind it
 * and one step in, and the fold taking the child out of sight and back. Every
 * mark comes from the surface table (packages/testing/data/surface.json).
 */
import surfaceTable from './data/surface.json' with { type: 'json' }

const surfaceAttribute = (id) => surfaceTable.surface.find((entry) => entry.id === id).attribute

/** The part mark the skin writes on the host's elements, and the row title's part value. */
const PART = surfaceAttribute('skin.part')

const PARENT = surfaceAttribute('fork-tree.parent')
const CHILD = surfaceAttribute('fork-tree.child')
const TOGGLE = surfaceAttribute('fork-tree.toggle')
const HIDDEN = surfaceAttribute('fork-tree.hidden')

/** The sidebar's session rows: the host's own key attribute, `session:` and the id. */
const ROW = '[data-row-key^="session:"]'

/** Read the rows the sidebar draws, and what the lineage marked on them. */
const readRows = (page) => page.evaluate((marks) => [...document.querySelectorAll(marks.row)].map((row) => {
  const title = row.querySelector(`[${marks.part}~="row-title"]`)
  const toggle = row.querySelector(`[${marks.toggle}]`)
  return {
    title: (title?.textContent ?? '').trim(),
    parent: row.hasAttribute(marks.parent),
    child: row.hasAttribute(marks.child),
    hidden: row.hasAttribute(marks.hidden),
    depth: row.getAttribute(marks.child),
    toggle: toggle !== null,
    expanded: toggle === null ? null : toggle.getAttribute('aria-expanded'),
  }
}), { row: ROW, part: PART, parent: PARENT, child: CHILD, toggle: TOGGLE, hidden: HIDDEN })

function forkTreeScenario({ check }) {
  return {
    script: 'greeting',
    prompt: 'hello there',
    async assert({ page, session }) {
      // The sidebar's row menu: the row's own action button, then the fork entry.
      await page.locator(ROW).first().hover()
      await page.waitForTimeout(300)
      await page.evaluate((row) => {
        const button = [...document.querySelectorAll(row + ' button')].find((candidate) => (candidate.getAttribute('aria-label') ?? '').includes('的操作'))
        button?.click()
      }, ROW)
      await page.waitForTimeout(500)
      const forkItem = page.locator('[role="menuitem"]').filter({ hasText: /分叉|Fork/ })
      if (await forkItem.count() > 0) await forkItem.first().click()
      await page.waitForFunction((mark) => document.querySelectorAll(`[${mark}]`).length > 0, CHILD, { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(400)

      const forked = await readRows(page)
      const childIndex = forked.findIndex((row) => row.child)
      const parentIndex = forked.findIndex((row) => row.parent)
      const child = forked[childIndex] ?? null
      const parent = forked[parentIndex] ?? null

      await page.locator(`${ROW} [${TOGGLE}]`).first().click()
      await page.waitForTimeout(200)
      const folded = await readRows(page)
      await page.locator(`${ROW} [${TOGGLE}]`).first().click()
      await page.waitForTimeout(200)
      const unfolded = await readRows(page)

      return [
        check('分叉会话收在源会话下面，缩进一级',
          parent !== null && child !== null && childIndex === parentIndex + 1 && child.depth === '1' && child.title.length > 0,
          JSON.stringify({ parentIndex, childIndex, child, parent })),
        check('源会话带着折起按钮，按一下就收起分支',
          parent !== null && parent.toggle && parent.expanded === 'true' &&
            (folded[childIndex]?.hidden === true) && (folded[parentIndex]?.expanded === 'false'),
          JSON.stringify({ parent, folded: folded[childIndex] })),
        check('再按一下分支回来',
          unfolded[childIndex]?.hidden === false && unfolded[parentIndex]?.expanded === 'true',
          JSON.stringify({ unfolded: unfolded[childIndex] })),
        check('控制台没有异常', session.problems.length === 0, session.problems.slice(0, 3).join(' | ')),
      ]
    },
  }
}

export { forkTreeScenario }
