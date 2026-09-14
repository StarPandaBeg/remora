import type { Entry } from '../../database/schema.ts'
import type {
    PipelineContext,
    StepDefinition,
    TaskDefinition,
} from '../types.ts'

export interface TaskContext extends PipelineContext {
    entry: Entry
}

interface MediaPrepareStepInput {
    bucket: string
    objectKey: string
    recordId: string
}
interface MediaPrepareStepOutput {
    bucket: string
    objectKey: string
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
            bucket: ctx.entry.metadata.file.bucket,
            objectKey: ctx.entry.metadata.file.objectKey,
            recordId: ctx.entry.metadata.file.recordId,
        }
    },

    validateOutput: async (output) => {
        void output
        // unknown for now
        return {
            bucket: 'remora',
            objectKey: '-',
        }
    },

    updateContext: async (ctx, output) => ({ ...ctx }),
}

export const VideoRecordSummaryTask: TaskDefinition = {
    type: 'video_summary',
    pipeline: [MediaPrepareStep],

    canUseEntry: (entry) => entry.type === 'video_record',
    buildContext: async (entry) => {
        return { entry }
    },
}
