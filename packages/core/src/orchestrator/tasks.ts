import { VideoRecordSummaryTask } from './tasks/video-summary/video-summary.task.ts'

export type TaskType = 'video_summary'

export const taskRegistry = {
    video_summary: VideoRecordSummaryTask,
}
