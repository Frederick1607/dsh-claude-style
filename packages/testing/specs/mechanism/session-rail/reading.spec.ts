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
import { railPath, railReading, railWidthPx, railWorkspace } from '@dsh-claude-style/client/pure'

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
