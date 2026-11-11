import type { FeatureManifest } from '../../core/feature'

export default {
  id: 'sidebarWidth',
  order: 269,
  contracts: ['shell.sidebar-root', 'shell.phase'],
  stylesheets: [],
  ungated: '侧栏宽度是宿主的布局值，没有开关可关：记住了就在下一次打开时放回去，记不住就照宿主的行为',
  cases: [],
} satisfies FeatureManifest
