import type { z } from 'zod/v4'

import type { JsonValue } from '../../types/json.ts'
import { configDefinitions } from './definitions.ts'

export interface ConfigDefinition {
    default: JsonValue
    schema: z.ZodType<JsonValue>
}

export type RuntimeConfigKey = keyof typeof configDefinitions

export type RuntimeConfig = {
    [K in RuntimeConfigKey]: z.output<(typeof configDefinitions)[K]['schema']>
}
