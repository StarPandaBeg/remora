import type { StepDefinition } from '../../types.ts'
import type { TaskContext } from './video-summary.task.ts'

interface AudioChunkingStepInput {
    audioSource: {
        bucket: string
        objectKey: string
    }
    recordId: string
}

interface AudioChunkingStepOutput {
    bucket: string
    manifestKey: string
}

export const AudioChunkingStep: StepDefinition<
    TaskContext,
    AudioChunkingStepInput,
    AudioChunkingStepOutput
> = {
    type: 'audio_chunking',

    buildInput: async (ctx) => {
        if (!ctx.mediaPrepare) {
            throw new Error('STEP_ORDER_INVALID')
        }
        return {
            audioSource: {
                bucket: ctx.entry.metadata.file!.bucket,
                objectKey: ctx.mediaPrepare.audioObjectKey,
            },
            recordId: ctx.entry.metadata.file!.recordId,
        }
    },

    validateOutput: async (output) => output as AudioChunkingStepOutput,

    updateContext: async (ctx, output) => {
        return {
            ...ctx,
            audioChunking: {
                manifestKey: output.manifestKey,
            },
        }
    },
}
