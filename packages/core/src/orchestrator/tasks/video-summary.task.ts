import type { Entry } from '../../database/schema.ts'
import type {
    PipelineContext,
    StepDefinition,
    TaskDefinition,
} from '../types.ts'

export interface TaskContext extends PipelineContext {
    entry: Entry
    mediaPrepare?: {
        videoObjectKey: string
    }
}

interface MediaPrepareStepInput {
    source: {
        bucket: string
        objectKey: string
    }
    mimetype: string
    recordId: string
}
interface MediaPrepareStepOutput {
    bucket: string
    videoObjectKey: string
}

/** Кодирование исходного видео */
const MediaPrepareStep: StepDefinition<
    TaskContext,
    MediaPrepareStepInput,
    MediaPrepareStepOutput
> = {
    type: 'media_prepare',

    buildInput: async (ctx) => {
        if (!ctx.entry.metadata.file) {
            throw new Error('ENTRY_NOT_SUPPORTED')
        }
        return {
            source: {
                bucket: ctx.entry.metadata.file.bucket,
                objectKey: ctx.entry.metadata.file.objectKey,
            },
            mimetype: ctx.entry.metadata.file.mimeType,
            recordId: ctx.entry.metadata.file.recordId,
        }
    },

    validateOutput: async (output) => {
        return output as MediaPrepareStepOutput
    },

    updateContext: async (ctx, output) => {
        return {
            ...ctx,
            mediaPrepare: { videoObjectKey: output.videoObjectKey },
        }
    },
}

export const VideoRecordSummaryTask: TaskDefinition = {
    type: 'video_summary',
    pipeline: [MediaPrepareStep],

    canUseEntry: (entry) => entry.type === 'video_record',
    selectConfig: (config) => ({
        'video_record.prefer_source': config['video_record.prefer_source'],
    }),
    buildContext: async (entry) => {
        return { entry }
    },
}
