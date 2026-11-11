import { PACKAGE_NAME } from '@dsh-claude-ui/contracts/package'
import { createCacheFiles } from '@dsh-claude-ui/engine/node/cache-file'

/** This plugin's derived cache files (packages/engine/node/cache-file.ts). */
export const { cachePath, readJsonDocument, writeJsonDocument } = createCacheFiles(PACKAGE_NAME)
