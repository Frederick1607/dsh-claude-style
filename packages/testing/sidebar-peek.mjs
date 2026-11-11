#!/usr/bin/env node
/**
 * sidebar-peek.mjs — the collapsed sidebar opened over the page from a hover (D87).
 *
 * Registered in the lane's scenario table (packages/testing/scenarios.mjs).
 *
 * The skin opens the host's own sidebar while the pointer rests on the rail's
 * toggle, and keeps the page from making room for it
 * (packages/client/src/features/sidebar-peek/). The scenario collapses the
 * rail on the real host, then reads what a reader sees, judged on the host's
 * own collapse marker and the boxes of the first two columns: the centre keeps
 * its box while the sidebar stands over it at its open width; leaving closes
 * it with the centre standing still; a click on the toggle keeps it open and
 * the centre then makes room; picking a session in it closes it behind the
 * switch.
 */
import surfaceTable from './data/surface.json' with { type: 'json' }
import { collapseRail } from './sidebar-rail.mjs'

/** The skin's part mark, read off the surface table rather than spelled here (D87). */
const PART = surfaceTable.surface.find((entry) => entry.id === 'skin.part').attribute
const part = (name) => `[${PART}~="${name}"]`

const PEEK = {
  frame: part('layout-frame'),
  column: `${part('layout-frame')} > ${part('sidebar-column')}`,
  center: `${part('layout-frame')} > ${part('center-column')}`,
  // The host seats the column's own toggle in the desktop caption strip or the
  // web top row (packages/contracts/src/dom.ts); the desktop opens a collapsed
  // sidebar from the frame's leading-seat opener, read by the skin's own
  // resolver (packages/engine/src/host.ts) and outside this web lane.
  toggle: part('sidebar-toggle'),
  sessionRow: part('session-row'),
}

/** The narrowest column that reads as the open sidebar rather than the rail. */
const OPEN_WIDTH_PX = 200

/** The host's collapse marker and the boxes of the first two columns. */
const readFrame = (page) => page.evaluate((peek) => {
  const frame = document.querySelector(peek.frame)
  const box = (selector) => {
    const element = document.querySelector(selector)
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return { left: Math.round(rect.left), width: Math.round(rect.width) }
  }
  return {
    collapsed: frame !== null && frame.hasAttribute('data-sidebar-collapsed'),
    column: box(peek.column),
    center: box(peek.center),
  }
}, PEEK)

/**
 * Read the frame once its boxes have stopped moving.
 *
 * The host eases the column's width and the frame's track back to the
 * collapsed width, and the collapse marker arrives with the first frame of
 * that move: a read taken then reads the column at its open width and the
 * centre pushed aside, which is the move and not the state. So the frame is
 * read again until two readings agree.
 */
async function settledFrame(page) {
  let previous = await readFrame(page)
  for (let tries = 0; tries < 40; tries += 1) {
    await page.waitForTimeout(100)
    const now = await readFrame(page)
    if (JSON.stringify(now) === JSON.stringify(previous)) return now
    previous = now
  }
  return previous
}

/** Wait until the host has the sidebar collapsed, or open with the column at its open width. */
const waitForSidebar = (page, collapsed) => page.waitForFunction(([peek, folded, wide]) => {
  const frame = document.querySelector(peek.frame)
  const column = document.querySelector(peek.column)
  if (frame === null || column === null) return false
  if (folded) return frame.hasAttribute('data-sidebar-collapsed')
  return !frame.hasAttribute('data-sidebar-collapsed') && column.getBoundingClientRect().width >= wide
}, [PEEK, collapsed, OPEN_WIDTH_PX], { timeout: 5000 }).then(() => true, () => false)

/**
 * The point the reader rests on: the centre of the box the host's toggle keeps.
 * The button painted there is the skin's copy while it stands, so the pointer
 * is moved by coordinates rather than by asking the host's button to receive it
 * — the copy is the button on top.
 */
const togglePoint = (page) => page.evaluate((peek) => {
  const button = document.querySelector(peek.toggle)
  if (button === null) return null
  const rect = button.getBoundingClientRect()
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
}, PEEK)

/** Rest the pointer on the rail's toggle until the sidebar stands open, its entrance played out. */
async function openPeek(page) {
  const point = await togglePoint(page)
  if (point !== null) await page.mouse.move(point.x, point.y)
  const opened = await waitForSidebar(page, false)
  await page.waitForTimeout(400)
  return opened
}

/**
 * The box of the button the reader sees under the pointer. The host's toggle is
 * the anchor — it stays in the DOM while the layer stands, though the layer
 * hides it — and the button painted there is read by hit-testing its centre:
 * the skin stands its own copy in that box (sidebar-peek.ts), so the host
 * button's own box moves with the column while the painted one does not.
 */
const paintedBox = (page, point) => page.evaluate(({ point }) => {
  const painted = document.elementFromPoint(point.x, point.y)?.closest('button') ?? null
  if (painted === null) return null
  const box = painted.getBoundingClientRect()
  return { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) }
}, { point })

const toggleBox = (page) => togglePoint(page).then((point) => (point === null ? null : paintedBox(page, point)))

/**
 * Watch the button's box while an action runs: every frame that draws no button
 * under the point is a blink, and the skin's copy is what keeps every frame
 * covered (sidebar-peek.ts).
 *
 * @returns the moments, in milliseconds from the start, a frame drew no button there.
 */
async function watchButton(page, box, ms, run) {
  const watching = page.evaluate(({ x, y, window: length, peekFrame }) => new Promise((resolve) => {
    const missing = []
    const startedAt = performance.now()
    const tick = () => {
      const hit = document.elementFromPoint(x, y)
      const button = hit?.closest('button') ?? null
      if (hit === null || button === null) missing.push({
        at: Math.round(performance.now() - startedAt),
        tag: hit?.tagName ?? null,
        cls: hit === null ? null : String(hit.className).slice(0, 24),
        collapsed: document.querySelector(peekFrame)?.hasAttribute('data-sidebar-collapsed') ?? null,
        buttons: document.querySelectorAll('button').length,
      })
      if (performance.now() - startedAt < length) requestAnimationFrame(tick)
      else resolve(missing)
    }
    requestAnimationFrame(tick)
  }), { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2), window: ms, peekFrame: PEEK.frame })
  await run()
  return watching
}

/** Somewhere in the centre, well clear of the sidebar's open width. */
async function leave(page) {
  const viewport = page.viewportSize()
  await page.mouse.move(Math.round(viewport.width * 0.75), Math.round(viewport.height / 2))
}

/**
 * Watch the centre while the pointer leaves the peek.
 *
 * The peek keeps the page standing where it was, so its close is the column
 * sliding away and nothing else: a centre that moves here is the host folding
 * its track a second time under the page.
 */
const centerHeldWhileLeaving = (page, center) => page.evaluate(({ peek, held, ms }) => new Promise((resolve) => {
  const element = document.querySelector(peek.center)
  const box = () => {
    const rect = element.getBoundingClientRect()
    return { left: Math.round(rect.left), width: Math.round(rect.width) }
  }
  const startedAt = performance.now()
  const moved = []
  const tick = () => {
    const now = box()
    if (now.left !== held.left || now.width !== held.width) moved.push(now)
    if (performance.now() - startedAt < ms) requestAnimationFrame(tick)
    else resolve(moved)
  }
  requestAnimationFrame(tick)
}), { peek: PEEK, held: center, ms: 900 })

function sidebarPeekScenario({ check }) {
  return {
    script: 'greeting',
    prompt: 'hello there',
    async beforeSend({ page }) {
      await collapseRail(page)
    },
    async assert({ page, session }) {
      await leave(page)
      await waitForSidebar(page, true)
      const before = await settledFrame(page)

      const resting = await toggleBox(page)
      const blinkOnOpen = await watchButton(page, resting, 900, () => openPeek(page).then(() => page.waitForTimeout(200)))
      const opened = await waitForSidebar(page, false)
      const open = await settledFrame(page)
      const during = await paintedBox(page, { x: resting.left + resting.width / 2, y: resting.top + resting.height / 2 })

      const blinkOnClose = await watchButton(page, resting, 1200, async () => {
        await leave(page)
        await waitForSidebar(page, true)
        await page.waitForTimeout(300)
      })
      const held = centerHeldWhileLeaving(page, before.center)
      const closed = await waitForSidebar(page, true)
      const after = await settledFrame(page)
      const moved = await held

      await openPeek(page)
      // While the peek stands, the copy the skin stands there is the control that pins it.
      await page.mouse.click(Math.round(resting.left + resting.width / 2), Math.round(resting.top + resting.height / 2))
      await leave(page)
      await page.waitForTimeout(800)
      const pinned = await settledFrame(page)
      await collapseRail(page)

      await openPeek(page)
      const row = await page.evaluate((peek) => {
        const element = document.querySelector(`${peek.column} ${peek.sessionRow}`)
        if (element === null) return null
        const rect = element.getBoundingClientRect()
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      }, PEEK)
      if (row !== null) await page.mouse.click(row.x, row.y)
      const picked = await waitForSidebar(page, true)

      const same = (a, b) => a !== null && b !== null && a.left === b.left && a.width === b.width
      return [
        check('侧栏已收起',
          before.collapsed && before.center !== null,
          JSON.stringify(before)),
        check('鼠标停在收起按钮上，宿主打开侧栏，侧栏以展开宽度浮在页面上方',
          opened && !open.collapsed && open.column !== null && open.column.left === 0 && open.column.width >= OPEN_WIDTH_PX,
          JSON.stringify(open)),
        check('浮出期间切换按钮留在原处',
          resting !== null && during !== null && Math.abs(resting.left - during.left) <= 2 && Math.abs(resting.top - during.top) <= 2,
          JSON.stringify({ resting, during })),
        check('侧栏浮在上方时主区的位置与宽度和收起时一样',
          same(before.center, open.center),
          JSON.stringify({ before: before.center, open: open.center })),
        check('鼠标移开后侧栏收起，主区回到原来的盒子',
          closed && same(before.center, after.center),
          JSON.stringify(after)),
        check('收起期间主区不跟着动',
          moved.length === 0,
          JSON.stringify(moved.slice(0, 2))),
        check('展开时点击按钮让侧栏固定展开，鼠标移开也不收起，主区让出侧栏的宽度',
          !pinned.collapsed && pinned.column !== null && pinned.center !== null &&
            pinned.center.left >= pinned.column.width - 1,
          JSON.stringify(pinned)),
        check('在浮起的侧栏里选中会话后侧栏自动收起', picked, ''),
        check('打开时盒子里始终有按钮，不闪',
          blinkOnOpen.length === 0,
          JSON.stringify(blinkOnOpen.slice(0, 5))),
        check('收起时盒子里始终有按钮，不闪',
          blinkOnClose.length === 0,
          JSON.stringify(blinkOnClose.slice(0, 5))),
        check('控制台没有异常', session.problems.length === 0, session.problems.slice(0, 3).join(' | ')),
      ]
    },
  }
}

export { sidebarPeekScenario }
