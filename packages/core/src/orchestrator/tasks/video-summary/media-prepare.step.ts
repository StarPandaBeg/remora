import type { StepDefinition } from '../../types.ts'
import type { TaskContext } from './video-summary.task.ts'

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
    audioObjectKey: string
}

/** Кодирование исходного видео */
export const MediaPrepareStep: StepDefinition<
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
            mediaPrepare: {
                videoObjectKey: output.videoObjectKey,
                audioObjectKey: output.audioObjectKey,
            },
        }
    },
}
