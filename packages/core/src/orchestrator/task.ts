import type { TaskDefinition } from './types.ts'

const VideoRecordSummaryTask: TaskDefinition = {
    type: 'video_record_summary',
    pipeline: ['media_prepare', 'transcript'],

    canUseEntry: (entry) => entry.type === 'video_record',
}

export const taskRegistry = {
    video_record_summary: VideoRecordSummaryTask,
} satisfies Record<string, TaskDefinition>
export type TaskType = keyof typeof taskRegistry
