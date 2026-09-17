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
    'video_record.voice_recognition.provider': {
        default: 'local',
        schema: z.literal(['local', 'ollama', 'openrouter']),
    },
    'video_record.voice_recognition.model': {
        default: 'turbo',
        schema: z.string(),
    },
    'video_record.voice_recognition.language': {
        default: 'ru',
        schema: z.string().nullable(),
    },
    'video_record.voice_recognition.prompt': {
        default: null,
        schema: z.string().nullable(),
    },
    'video_record.voice_recognition.temperature': {
        default: 0.0,
        schema: z.float32(),
    },
    'video_record.voice_recognition.task': {
        default: 'transcribe',
        schema: z.literal(['transcribe', 'translate']),
    },
    'video_record.voice_recognition.ollama_base_url': {
        default: 'http://localhost:11434',
        schema: z.url(),
    },
    'video_record.voice_recognition.ollama_api_key': {
        default: null,
        schema: z.string().nullable(),
    },
    'video_record.voice_recognition.openrouter_base_url': {
        default: 'https://openrouter.ai/api/v1',
        schema: z.url(),
    },
    'video_record.voice_recognition.openrouter_api_key': {
        default: null,
        schema: z.string().nullable(),
    },
    'video_record.voice_recognition.parallel_tasks': {
        default: 3,
        schema: z.int().min(1).max(8),
    },
    'video_record.diarization.enabled': {
        default: false,
        schema: z.boolean(),
    },
    'video_record.diarization.model': {
        default: 'pyannote/speaker-diarization-community-1',
        schema: z.string(),
    },
    'video_record.diarization.token': {
        default: null,
        schema: z.string().nullable(),
    },
    'video_record.diarization.num_speakers': {
        default: null,
        schema: z.int().min(1).nullable(),
    },
    'video_record.diarization.min_speakers': {
        default: null,
        schema: z.int().min(1).nullable(),
    },
    'video_record.diarization.max_speakers': {
        default: null,
        schema: z.int().min(1).nullable(),
    },
    'video_record.diarization.exclusive': {
        default: true,
        schema: z.boolean(),
    },
} satisfies Record<string, ConfigDefinition>
