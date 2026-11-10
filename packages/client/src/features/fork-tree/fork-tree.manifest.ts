import type { FeatureManifest } from '../../core/feature'

export default {
  id: 'forkTree',
  order: 268,
  contracts: ['session.row', 'session.row-key'],
  pref: 'forkTree',
  stylesheets: [{ file: 'fork-tree.css', rank: 391 }],
  settingsRows: [{
    tab: 'sidebar',
    rank: 38,
    pref: 'forkTree',
    title: 'forkTreeTitle',
    desc: 'forkTreeDesc',
  }],
  cases: [],
} satisfies FeatureManifest
