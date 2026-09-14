import type { z } from 'zod/v4'

import { configDefinitions } from './definitions.ts'

export type RuntimeConfigKey = keyof typeof configDefinitions

export type RuntimeConfig = {
    [K in RuntimeConfigKey]: z.output<(typeof configDefinitions)[K]['schema']>
}
