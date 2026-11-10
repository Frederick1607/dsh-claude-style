import type { FeatureManifest } from '../../core/feature'

export default {
  id: 'sessionRail',
  order: 267,
  contracts: ['chat.content', 'chat.scroller', 'shell.phase'],
  pref: 'sessionRail',
  stylesheets: [{ file: 'session-rail.css', rank: 390 }],
  settingsRows: [{
    tab: 'sidebar',
    rank: 36,
    pref: 'sessionRail',
    title: 'railTitleSetting',
    desc: 'railDescSetting',
  }, {
    tab: 'sidebar',
    rank: 37,
    pref: 'sessionRailWidth',
    title: 'railWidthTitle',
    desc: 'railWidthDesc',
    choiceLabels: {
      narrow: 'railWidthNarrow',
      standard: 'railWidthStandard',
      wide: 'railWidthWide',
    },
  }],
  cases: [],
} satisfies FeatureManifest
