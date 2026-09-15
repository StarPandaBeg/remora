import type { Entry } from '../../../database/schema.ts'
import type { PipelineContext, TaskDefinition } from '../../types.ts'
import { AudioChunkingStep } from './audio-chunking.step.ts'
import { MediaPrepareStep } from './media-prepare.step.ts'

export interface TaskContext extends PipelineContext {
    entry: Entry
    mediaPrepare?: {
        videoObjectKey: string
        audioObjectKey: string
    }
    audioChunking?: {
        manifestKey: string
    }
}

export const VideoRecordSummaryTask: TaskDefinition = {
    type: 'video_summary',
    pipeline: [MediaPrepareStep, AudioChunkingStep],

    canUseEntry: (entry) => entry.type === 'video_record',
    selectConfig: (config) => ({
        preferSource: config['video_record.prefer_source'],
        chunking: {
            targetDuration: config['video_record.chunking.target_duration'],
            minDuration: config['video_record.chunking.min_duration'],
            maxDuration: config['video_record.chunking.max_duration'],
            minGoodSilence:
                config['video_record.chunking.min_good_silience'],
            paddingBefore: config['video_record.chunking.padding_before'],
            paddingAfter: config['video_record.chunking.padding_after'],
        },
    }),
    buildContext: async (entry) => {
        return { entry }
    },
}
