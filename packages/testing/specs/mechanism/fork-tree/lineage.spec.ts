/**
 * The sidebar's fork lineage is read from the titles the client controller
 * writes: a fork is renamed to its source's title with the counter moved on
 * (`X` -> `X (1)`, `X (1)` -> `X (2)`), and the host keeps no parent field
 * beside it. These tests hold the title grammar, the pairing rule (a title two
 * rows answer draws no pair) and the depth a chain of forks reaches.
 *
 * @capability fork-tree
 * @features fork-tree
 * @risk A title read wrongly nests a session under a stranger or hides it behind the wrong source's fold, and an ambiguous title that is paired anyway moves two unrelated rows out of the order the list drew them in.
 *
 * The lane reads the rows the feature marks through the surface table:
 * 'fork-tree.parent', 'fork-tree.child', 'fork-tree.toggle' and
 * 'fork-tree.hidden'.
 */
import { expect, test } from 'vitest'
import { forkDepths, forkOrder, forkPairs, forkSourceTitles } from '@dsh-claude-style/client/pure'

test('a first fork names its source, and a later one names the counter before it', () => {
  expect(forkSourceTitles('Report (1)')).toEqual(['Report'])
  expect(forkSourceTitles('Report (2)')).toEqual(['Report (1)'])
  expect(forkSourceTitles('Report (12)')).toEqual(['Report (11)'])
})

test('a full-width counter is the counter too', () => {
  expect(forkSourceTitles('报告（1）')).toEqual(['报告'])
  expect(forkSourceTitles('报告（3）')).toEqual(['报告（2）'])
})

test('a title without a counter names no source, and neither does a zero', () => {
  expect(forkSourceTitles('Report')).toEqual([])
  expect(forkSourceTitles('Report (0)')).toEqual([])
  expect(forkSourceTitles('Notes (final)')).toEqual([])
  expect(forkSourceTitles('')).toEqual([])
})

test('the pair is drawn where exactly one row carries the source title', () => {
  const pairs = forkPairs([
    { id: 'a', title: 'Report' },
    { id: 'b', title: 'Report (1)' },
    { id: 'c', title: 'Other' },
    { id: 'd', title: 'Other' },
    { id: 'e', title: 'Other (1)' },
  ])
  expect([...pairs]).toEqual([['b', 'a']])
})

test('a chain of forks pairs each child with the row its counter names', () => {
  const pairs = forkPairs([
    { id: 'a', title: 'Report' },
    { id: 'b', title: 'Report (1)' },
    { id: 'c', title: 'Report (2)' },
  ])
  expect([...pairs]).toEqual([['b', 'a'], ['c', 'b']])
})

test('a row never stands under itself', () => {
  const pairs = forkPairs([{ id: 'a', title: 'Report (1)' }])
  expect(pairs.size).toBe(0)
})

test('a chain of forks is indented level by level, and a cycle stops at the point it closes', () => {
  const chain = forkDepths(new Map([['b', 'a'], ['c', 'b']]))
  expect(chain.get('b')).toBe(1)
  expect(chain.get('c')).toBe(2)
  const cycle = forkDepths(new Map([['a', 'b'], ['b', 'a']]))
  expect(cycle.get('a')).toBe(2)
  expect(cycle.get('b')).toBe(2)
})

test('a source keeps its place and each branch stands directly behind it', () => {
  const pairs = new Map([['b', 'a'], ['c', 'a'], ['d', 'c']])
  expect(forkOrder(['a', 'b', 'x', 'c', 'd'], pairs)).toEqual(['a', 'b', 'c', 'd', 'x'])
})

test('a branch whose source is not in the list keeps the list order, and every row stands once', () => {
  const pairs = new Map([['b', 'gone']])
  expect(forkOrder(['a', 'b', 'c'], pairs)).toEqual(['a', 'b', 'c'])
  const cycle = new Map([['a', 'b'], ['b', 'a']])
  expect(forkOrder(['a', 'b'], cycle).sort()).toEqual(['a', 'b'])
})
