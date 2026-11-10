import { featureCopy } from '../../core/i18n'
import entries from './session-rail.copy.json'
import type { CopyParams } from '../../core/i18n'

export const copy = (key: keyof typeof entries, params?: CopyParams) => featureCopy(entries, key, params)
