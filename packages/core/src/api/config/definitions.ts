import * as z from 'zod'

import type { ConfigDefinition } from './types.ts'

export const configDefinitions = {
    'video_record.prefer_source': {
        default: false,
        schema: z.boolean(),
    },
    'video_record.chunking.target_duration': {
        default: 300.0,
        schema: z.float32(),
    },
    'video_record.chunking.min_duration': {
        default: 180.0,
        schema: z.float32(),
    },
    'video_record.chunking.max_duration': {
        default: 420.0,
        schema: z.float32(),
    },
    'video_record.chunking.min_good_silience': {
        default: 0.8,
        schema: z.float32(),
    },
    'video_record.chunking.padding_before': {
        default: 0.25,
        schema: z.float32(),
    },
    'video_record.chunking.padding_after': {
        default: 0.25,
        schema: z.float32(),
    },
} satisfies Record<string, ConfigDefinition>
