/**
 * The session rail's reading and its environment row are worked out without
 * the page: the context's share, the counts it stands on, the workspace the
 * shown session joined, and the path's home folding. The rail draws these
 * figures; a missing projection leaves the unknown ends null so the rail writes
 * its dash rather than a zero it never measured.
 *
 * @capability session-rail
 * @features session-rail
 * @risk A reading that treats a missing window as zero divides by nothing and draws a share the host never measured, or hides a count it does know; a workspace lookup that scans the wrong row names a workspace the session never joined.
 *
 * The lane reads the rail's marks through the surface table:
 * 'session-rail.host', 'session-rail.part', 'session-rail.state' and
 * 'session-rail.section'.
 */
import { expect, test } from 'vitest'
import { fileBasename, railOutputs, railOutputsAfter, railPath, railReading, railWidthPx, railWorkspace } from '@dsh-claude-style/client/pure'
import type { HostFeedEntry } from '@dsh-claude-style/contracts/services'

test('the reading carries the share, the held tokens and what the window still holds', () => {
  expect(railReading({ projectedTokens: 250_000, contextWindow: 1_000_000 })).toEqual({
    percent: 25,
    used: 250_000,
    free: 750_000,
    window: 1_000_000,
  })
})

test('the settled pressure figure stands in while no projection is streaming', () => {
  expect(railReading({ pressureTokens: 333_000, contextWindow: 1_000_000 }).percent).toBe(33)
})

test('a projection without a count holds no share, and the window still answers its size', () => {
  expect(railReading({ contextWindow: 1_000_000 })).toEqual({ percent: null, used: null, free: 1_000_000, window: 1_000_000 })
  expect(railReading(null)).toEqual({ percent: null, used: null, free: null, window: null })
})

test('a count without a window keeps the count and drops the share', () => {
  expect(railReading({ projectedTokens: 4_000 })).toEqual({ percent: null, used: 4_000, free: null, window: null })
})

test('the share stops at the whole window and the free end never goes under zero', () => {
  const over = railReading({ projectedTokens: 1_200_000, contextWindow: 1_000_000 })
  expect(over.percent).toBe(100)
  expect(over.free).toBe(0)
})

test('the workspace is the row whose sessions hold the shown session', () => {
  const snapshot = {
    phase: 'ready',
    archivedSessionIds: [],
    items: [
      { workspaceId: 'a', title: 'Alpha', path: '/Users/frederick/alpha', sessionIds: ['s1'] },
      { workspaceId: 'b', title: 'Beta', path: '/Users/frederick/beta', sessionIds: ['s2'] },
    ],
  }
  expect(railWorkspace(snapshot, 's2')).toEqual({ title: 'Beta', path: '/Users/frederick/beta' })
  expect(railWorkspace(snapshot, 's9')).toBeNull()
  expect(railWorkspace(snapshot, null)).toBeNull()
  expect(railWorkspace(null, 's1')).toBeNull()
})

test('the path folds the reader home and keeps a folder elsewhere whole', () => {
  expect(railPath('/Users/frederick/Developer/ClaudeUI')).toBe('~/Developer/ClaudeUI')
  expect(railPath('/home/frederick/work')).toBe('~/work')
  expect(railPath('/opt/claude')).toBe('/opt/claude')
  expect(railPath('')).toBe('')
})

test('a width choice draws its own column, and an unknown one the standard', () => {
  expect(railWidthPx('narrow')).toBe(232)
  expect(railWidthPx('standard')).toBe(264)
  expect(railWidthPx('wide')).toBe(304)
  expect(railWidthPx('huge')).toBe(264)
  expect(railWidthPx(null)).toBe(264)
})

/** One feed entry presenting files in a turn. */
function presented(turn: number, files: { path: string, description?: string }[]): HostFeedEntry {
  return { type: 'event', event: { type: 'deliverables/presented', data: { turn, callId: `call-${turn}`, files } } }
}

/** One turn start: a feed entry the outputs fold ignores. */
const opened: HostFeedEntry = { type: 'event', event: { type: 'turn/end', data: { reason: { kind: 'done' } } } }

test('the outputs fold lists delivered files in declaration order, a redeclaration taking the newer description', () => {
  const outputs = railOutputs([
    opened,
    presented(1, [{ path: '/work/report.md', description: 'The report' }, { path: '/work/figures/' }]),
    presented(2, [{ path: '/work/report.md', description: 'The final report' }]),
  ])
  expect(outputs).toEqual([
    { path: '/work/figures/', name: 'figures', description: '' },
    { path: '/work/report.md', name: 'report.md', description: 'The final report' },
  ])
})

test('an append folds only what arrived, keeping what the window already listed', () => {
  const start = railOutputs([presented(1, [{ path: '/work/a.md' }])])
  const grown = railOutputsAfter(start, [presented(2, [{ path: '/work/b.md', description: 'Second' }])])
  expect(grown).toEqual([
    { path: '/work/a.md', name: 'a.md', description: '' },
    { path: '/work/b.md', name: 'b.md', description: 'Second' },
  ])
})

test('an entry the fold cannot read is dropped rather than guessed', () => {
  const entries = [
    { type: 'event', event: { type: 'deliverables/presented', data: { turn: 1, callId: 'call', files: [{ path: '   ' }, { description: 'no path' }] } } },
    { type: 'event', event: { type: 'deliverables/presented', data: { turn: 2, callId: 'call', files: 'nope' } } },
    opened,
  ] as unknown as HostFeedEntry[]
  expect(railOutputs(entries)).toEqual([])
})

test('a path names its trailing segment, whichever separator it uses', () => {
  expect(fileBasename('/work/figures/plot.png')).toBe('plot.png')
  expect(fileBasename('C:\\work\\deck.pptx')).toBe('deck.pptx')
  expect(fileBasename('notes.md')).toBe('notes.md')
  expect(fileBasename('/work/figures/')).toBe('figures')
})
