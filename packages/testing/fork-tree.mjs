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

/** Read where the section header stands against the rows: the workspace's title keeps its place above them. */
const readHeader = (page) => page.evaluate((marks) => {
  const header = document.querySelector(`[${marks.part}~="section-header"]`)
  const rows = [...document.querySelectorAll(marks.row)]
  if (header === null) return { header: false, above: [] }
  return {
    header: true,
    above: rows.map((row) => (header.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
  }
}, { part: PART, row: ROW })

/** Read the title and the chevron of a row: the running title's shimmer matches the title only as the row's own child. */
const readTitleShape = (page) => page.evaluate((marks) => {
  const row = document.querySelector(`[data-row-key^="session:"]:has([${marks.child}])`)?.previousElementSibling
  const first = document.querySelector(`[data-row-key^="session:"]`)
  const source = row ?? first
  if (source === null) return null
  const title = source.querySelector(`[${marks.part}~="row-title"]`)
  const toggle = source.querySelector(`[${marks.toggle}]`)
  if (title === null || toggle === null) return null
  return {
    titleDirect: title.parentElement === source,
    toggleDirect: toggle.parentElement === source,
    titleHoldsToggle: title.contains(toggle),
  }
}, { part: PART, child: CHILD, toggle: TOGGLE })

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

/** The session the conversation shows: the skin writes the host's own mark on the body. */
const readCurrent = (page) => page.evaluate(() => {
  const body = document.querySelector('[data-conversation-session]')
  return body === null ? null : body.getAttribute('data-conversation-session')
})

/** The sidebar's session rows, in the order the list draws them. */
const readIds = (page) => page.evaluate(() => [...document.querySelectorAll('[data-row-key^="session:"]')]
  .map((row) => (row.getAttribute('data-row-key') ?? '').slice('session:'.length)))

/** Open a row's own menu and press its fork entry: the sidebar's way to fork. */
async function forkRow(page, id) {
  const row = `[data-row-key="session:${id}"]`
  await page.locator(row).hover()
  await page.waitForTimeout(300)
  await page.evaluate((selector) => {
    const target = document.querySelector(selector)
    const button = target === null ? null : [...target.querySelectorAll('button')].find((candidate) => (candidate.getAttribute('aria-label') ?? '').includes('的操作'))
    button?.click()
  }, row)
  await page.waitForTimeout(500)
  const item = page.locator('[role="menuitem"]').filter({ hasText: /分叉|Fork/ })
  if (await item.count() > 0) await item.first().click()
  await page.waitForTimeout(800)
}

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
      const header = await readHeader(page)
      const shape = await readTitleShape(page)
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

      // A second fork under the same source, then the rows' own clicks: a branch
      // is a session row like any other, and a press has to open it.
      const idsBefore = await readIds(page)
      const sourceId = idsBefore[parentIndex] ?? null
      if (sourceId !== null) await forkRow(page, sourceId)
      await page.waitForFunction((mark) => document.querySelectorAll(`[${mark}]`).length >= 2, CHILD, { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(600)
      const many = await readRows(page)
      const manyIds = await readIds(page)
      const children = many.map((row, at) => (row.child ? at : -1)).filter((at) => at >= 0)
      const childIds = children.map((at) => manyIds[at] ?? null)

      // A fork of a branch: the chain the sidebar shows as a deeper lineage, and
      // the row that has to stay pressable at the end of it.
      let grandchildId = null
      if (childIds[0] !== null && childIds[0] !== undefined) {
        const before = await readIds(page)
        await forkRow(page, childIds[0])
        await page.waitForTimeout(600)
        const after = await readIds(page)
        grandchildId = after.find((id) => !before.includes(id)) ?? null
      }
      const chain = await readRows(page)
      let grandchild = null
      if (grandchildId !== null) {
        await page.locator(`[data-row-key="session:${grandchildId}"]`).click()
        await page.waitForTimeout(500)
        grandchild = { id: grandchildId, current: await readCurrent(page) }
      }

      const clicks = []
      for (const id of [childIds[0], childIds[1], sourceId]) {
        if (id === null || id === undefined) { clicks.push({ id, current: null }); continue }
        await page.locator(`[data-row-key="session:${id}"]`).click()
        await page.waitForTimeout(500)
        clicks.push({ id, current: await readCurrent(page) })
      }

      return [
        check('两个分叉都排在源会话下面，各缩进一级',
          children.length >= 2 && children.every((at) => at > (sourceId === null ? -1 : manyIds.indexOf(sourceId))) &&
            children.every((at) => many[at].depth === '1'),
          JSON.stringify({ many: many.map((row, at) => ({ title: row.title, child: row.child, depth: row.depth })), manyIds, children })),
        check('分叉的分叉也点得开，且只缩进一级',
          grandchild !== null && grandchild.current === grandchild.id &&
            chain.every((row) => !row.child || row.depth === '1'),
          JSON.stringify({ grandchild, chain: chain.map((row) => ({ title: row.title, child: row.child, depth: row.depth })) })),
        check('分支与源会话都点得开',
          clicks.every((click) => click.id !== null && click.id !== undefined && click.current === click.id),
          JSON.stringify({ clicks })),
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
        check('分叉之后会话仍留在工作区标题下面',
          header.header && header.above.length > 0 && header.above.every(Boolean) && header.above.length === forked.length,
          JSON.stringify({ header: header.header, above: header.above })),
        check('分支按钮不挡住进行中标题的动效',
          shape !== null && shape.titleDirect && shape.toggleDirect && !shape.titleHoldsToggle,
          JSON.stringify(shape)),
        check('控制台没有异常', session.problems.length === 0, session.problems.slice(0, 3).join(' | ')),
      ]
    },
  }
}

export { forkTreeScenario }
