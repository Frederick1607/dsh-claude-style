#!/usr/bin/env node
/**
 * session-rail.mjs — the session rail beside the conversation (D87).
 *
 * Registered in the lane's scenario table (packages/testing/scenarios.mjs).
 *
 * The skin draws a column in the conversation body's right band and the
 * scroller keeps what is left, so nothing lies under the rail
 * (packages/client/src/features/session-rail/). The scenario reads the band the
 * rail takes against the scroller's own box and margin, the two sections it
 * carries, the fold that leaves the toggle alone, and the way back. Every mark
 * comes from the surface table (packages/testing/data/surface.json).
 */
import surfaceTable from './data/surface.json' with { type: 'json' }

const surfaceAttribute = (id) => surfaceTable.surface.find((entry) => entry.id === id).attribute

const HOST = surfaceAttribute('session-rail.host')
const STATE = surfaceAttribute('session-rail.state')
const PART = surfaceAttribute('session-rail.part')
const SECTION = surfaceAttribute('session-rail.section')
const CELL = surfaceAttribute('session-rail.cell')
const LEGEND = surfaceAttribute('session-rail.legend')

/** One element the rail draws, by the part it plays. */
const part = (name) => `[${PART}="${name}"]`

/** One section of the rail, by the section mark it carries. */
const section = (key) => `[${SECTION}="${key}"]`

const RAIL = {
  host: `[${HOST}]`,
  state: STATE,
  root: `[${HOST}] > ${part('rail')}`,
  toggle: part('toggle'),
  body: part('body'),
  environment: `[${SECTION}="environment"]`,
  tokens: part('tokens'),
  workspace: part('workspace-name'),
  rows: part('row-value'),
  section: SECTION,
  sectionToggle: part('section-toggle'),
  sectionBody: part('section-body'),
  matrix: part('context-treemap'),
  cell: CELL,
  legend: LEGEND,
  output: part('output'),
  outputsEmpty: part('outputs-empty'),
  scroller: '[data-conversation-scroll]',
}

/** The standard column's width, the width preference's default (packages/client/src/features/session-rail/reading.ts). */
const STANDARD_PX = 264
/** The strip the fold leaves, the toggle alone (session-rail.css). */
const STRIP_PX = 40

/** Read the rail, its band, the scroller beside it and the two sections that fold. */
const readRail = (page) => page.evaluate((rail) => {
  const box = (element) => {
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), width: Math.round(rect.width) }
  }
  const text = (selector) => {
    const element = document.querySelector(selector)
    return element === null ? '' : (element.textContent ?? '').trim()
  }
  const inside = (key) => `[${rail.section}="${key}"]`
  const readSection = (key) => {
    const scope = inside(key)
    const toggle = document.querySelector(`${scope} ${rail.sectionToggle}`)
    const body = document.querySelector(`${scope} ${rail.sectionBody}`)
    return {
      found: toggle !== null && body !== null,
      expanded: toggle === null ? null : toggle.getAttribute('aria-expanded'),
      bodyHidden: body === null ? null : body.hidden,
    }
  }
  const host = document.querySelector(rail.host)
  const root = document.querySelector(rail.root)
  const scroller = document.querySelector(rail.scroller)
  const body = document.querySelector(rail.body)
  return {
    present: host !== null && root !== null,
    state: host === null ? null : host.getAttribute(rail.state),
    hostBox: box(host),
    rail: box(root),
    scroller: box(scroller),
    margin: scroller === null ? null : Math.round(Number.parseFloat(getComputedStyle(scroller).marginRight)),
    bodyShown: body !== null && getComputedStyle(body).display !== 'none',
    workspace: text(rail.environment + ' ' + rail.workspace),
    tokens: text(rail.tokens),
    rows: [...document.querySelectorAll(rail.rows)].map((element) => (element.textContent ?? '').trim()),
    context: readSection('context'),
    outputs: {
      ...readSection('outputs'),
      empty: text(`${inside('outputs')} ${rail.outputsEmpty}`),
      rows: document.querySelectorAll(`${inside('outputs')} ${rail.output}`).length,
    },
  }
}, RAIL)

/** Wait for the rail to hang in a settled page. */
async function waitForRail(page) {
  await page.locator(RAIL.root).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(120)
}

function sessionRailScenario({ check }) {
  return {
    script: 'greeting',
    prompt: 'hello there',
    async beforeSend({ page }) {
      await page.locator(RAIL.root).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    },
    async assert({ page, session }) {
      await waitForRail(page)
      const open = await readRail(page)

      await page.locator(RAIL.toggle).first().click()
      await page.waitForTimeout(120)
      const folded = await readRail(page)

      await page.locator(RAIL.toggle).first().click()
      await page.waitForTimeout(120)
      const back = await readRail(page)

      // The context reading and the outputs list fold on their own headers.
      await page.locator(`${section('context')} ${RAIL.sectionToggle}`).first().click()
      await page.waitForTimeout(120)
      const contextClosed = await readRail(page)
      await page.locator(`${section('context')} ${RAIL.sectionToggle}`).first().click()
      await page.waitForTimeout(120)
      const contextOpen = await readRail(page)
      await page.locator(`${section('outputs')} ${RAIL.sectionToggle}`).first().click()
      await page.waitForTimeout(120)
      const outputsClosed = await readRail(page)

      const share = /(\d+%)|—/
      const matrix = await page.evaluate((marks) => {
        const cells = [...document.querySelectorAll(marks.matrix + ' [' + marks.cell + ']')].map((cell) => cell.getAttribute(marks.cell))
        const legend = [...document.querySelectorAll('[' + marks.legend + ']')].map((item) => item.getAttribute(marks.legend))
        return { cells: cells.length, kinds: [...new Set(cells)], legend }
      }, RAIL)
      return [
        check('对话正文右侧挂起会话详情栏',
          open.present && open.rail !== null && open.hostBox !== null &&
            open.rail.width === STANDARD_PX && open.rail.right === open.hostBox.right,
          JSON.stringify({ rail: open.rail, host: open.hostBox, state: open.state })),
        check('正文让出会话详情栏的宽度，没有内容压在栏下',
          open.margin === STANDARD_PX && open.scroller !== null && open.rail !== null && open.scroller.right <= open.rail.left + 1,
          JSON.stringify({ margin: open.margin, scroller: open.scroller, rail: open.rail })),
        check('环境段写着会话所在的工作区',
          open.workspace.length > 0,
          JSON.stringify({ workspace: open.workspace })),
        check('上下文段给出占用与窗口，三行读数都在',
          (/\d/.test(open.tokens) || open.tokens.includes('—')) && open.rows.length === 3 && open.rows.every((row) => row.length > 0),
          JSON.stringify({ tokens: open.tokens, rows: open.rows })),
        check('折起后只剩切换按钮，正文收回整幅宽度',
          folded.rail !== null && folded.rail.width === STRIP_PX && !folded.bodyShown && folded.margin === STRIP_PX && folded.state === 'closed',
          JSON.stringify({ rail: folded.rail, margin: folded.margin, bodyShown: folded.bodyShown, state: folded.state })),
        check('再按一次，会话详情栏回到原宽度',
          back.rail !== null && back.rail.width === STANDARD_PX && back.bodyShown && back.margin === STANDARD_PX && back.state === 'open',
          JSON.stringify({ rail: back.rail, margin: back.margin, bodyShown: back.bodyShown, state: back.state })),
        check('上下文段可以折起，再按一次展开',
          contextClosed.context.found && contextClosed.context.expanded === 'false' && contextClosed.context.bodyHidden === true &&
            contextOpen.context.expanded === 'true' && contextOpen.context.bodyHidden === false,
          JSON.stringify({ closed: contextClosed.context, open: contextOpen.context })),
        check('输出段列出交付文件，未交付时给出空态',
          open.outputs.found && open.outputs.expanded === 'true' && open.outputs.bodyHidden === false &&
            (open.outputs.rows > 0 || open.outputs.empty.length > 0),
          JSON.stringify(open.outputs)),
        check('输出段也能折起',
          outputsClosed.outputs.expanded === 'false' && outputsClosed.outputs.bodyHidden === true,
          JSON.stringify(outputsClosed.outputs)),
        check('上下文段画出窗口组成的拼块，图例说明每种颜色',
          matrix.cells >= 1 &&
            matrix.kinds.every((kind) => ['system', 'tools', 'conversation', 'free'].includes(kind)) &&
            matrix.legend.length === 4,
          JSON.stringify(matrix)),
        check('控制台没有异常', session.problems.length === 0, session.problems.slice(0, 3).join(' | ')),
      ]
    },
  }
}

export { sessionRailScenario }
