import type { Entry } from '../../../database/schema.ts'
import type { PipelineContext, TaskDefinition } from '../../types.ts'
import { AudioChunkingStep } from './audio-chunking.step.ts'
import { MediaPrepareStep } from './media-prepare.step.ts'
import { VoiceRecognitionStep } from './voice-recognition.step.ts'

export interface TaskContext extends PipelineContext {
    entry: Entry
    mediaPrepare?: {
        videoObjectKey: string
        audioObjectKey: string
    }
    audioChunking?: {
        manifestKey: string
    }
    voiceRecognition?: {
        transcriptionKey: string
        language: string
    }
}

export const VideoRecordSummaryTask: TaskDefinition = {
    type: 'video_summary',
    pipeline: [MediaPrepareStep, AudioChunkingStep, VoiceRecognitionStep],

    canUseEntry: (entry) => entry.type === 'video_record',
    selectConfig: (config) => ({
        preferSource: config['video_record.prefer_source'],
        chunking: {
            targetDuration: config['video_record.chunking.target_duration'],
            minDuration: config['video_record.chunking.min_duration'],
            maxDuration: config['video_record.chunking.max_duration'],
            minGoodSilence: config['video_record.chunking.min_good_silience'],
            paddingBefore: config['video_record.chunking.padding_before'],
            paddingAfter: config['video_record.chunking.padding_after'],
        },
        voiceRecognition: {
            provider: config['video_record.voice_recognition.provider'],
            model: config['video_record.voice_recognition.model'],
            language: config['video_record.voice_recognition.language'],
            prompt: config['video_record.voice_recognition.prompt'],
            temperature: config['video_record.voice_recognition.temperature'],
            task: config['video_record.voice_recognition.task'],
            ollamaBaseUrl:
                config['video_record.voice_recognition.ollama_base_url'],
            ollamaApiKey:
                config['video_record.voice_recognition.ollama_api_key'],
            openrouterBaseUrl:
                config['video_record.voice_recognition.openrouter_base_url'],
            openrouterApiKey:
                config['video_record.voice_recognition.openrouter_api_key'],
            parallelTasks:
                config['video_record.voice_recognition.parallel_tasks'],
        },
        diarization: {
            enabled: config['video_record.diarization.enabled'],
            model: config['video_record.diarization.model'],
            token: config['video_record.diarization.token'],
            numSpeakers: config['video_record.diarization.num_speakers'],
            minSpeakers: config['video_record.diarization.min_speakers'],
            maxSpeakers: config['video_record.diarization.max_speakers'],
            useExclusive: config['video_record.diarization.exclusive'],
        },
    }),
    buildContext: async (entry) => {
        return { entry }
    },
}
