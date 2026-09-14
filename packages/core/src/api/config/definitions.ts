import * as z from 'zod'

import type { ConfigDefinition } from './types.ts'

export const configDefinitions = {
    'video_record.prefer_source': {
        default: false,
        schema: z.boolean(),
    },
} satisfies Record<string, ConfigDefinition>
