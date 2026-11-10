import { featureCopy } from '../../core/i18n'
import entries from './fork-tree.copy.json'
import type { CopyParams } from '../../core/i18n'

export const copy = (key: keyof typeof entries, params?: CopyParams) => featureCopy(entries, key, params)
