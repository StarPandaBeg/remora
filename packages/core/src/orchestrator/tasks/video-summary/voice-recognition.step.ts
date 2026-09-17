import type { StepDefinition } from '../../types.ts'
import type { TaskContext } from './video-summary.task.ts'

interface VoiceRecognitionStepInput {
    manifestSource: {
        bucket: string
        objectKey: string
    }
    audioSource: {
        bucket: string
        objectKey: string
    }
    recordId: string
}

interface VoiceRecognitionStepOutput {
    bucket: string
    language: string
    transcriptionKey: string
}

export const VoiceRecognitionStep: StepDefinition<
    TaskContext,
    VoiceRecognitionStepInput,
    VoiceRecognitionStepOutput
> = {
    type: 'voice_recognition',

    buildInput: async (ctx) => {
        if (!ctx.audioChunking) {
            throw new Error('STEP_ORDER_INVALID')
        }
        return {
            manifestSource: {
                bucket: ctx.entry.metadata.file!.bucket,
                objectKey: ctx.audioChunking.manifestKey,
            },
            audioSource: {
                bucket: ctx.entry.metadata.file!.bucket,
                objectKey: ctx.mediaPrepare!.audioObjectKey,
            },
            recordId: ctx.entry.metadata.file!.recordId,
        }
    },

    validateOutput: async (output) => output as VoiceRecognitionStepOutput,

    updateContext: async (ctx, output) => {
        return {
            ...ctx,
            voiceRecognition: {
                transcriptionKey: output.transcriptionKey,
                language: output.language,
            },
        }
    },
}
