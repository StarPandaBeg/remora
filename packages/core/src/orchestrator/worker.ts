interface WorkerEventStart {
    type: 'task.started'
    taskId: number
}

interface WorkerEventProgress {
    type: 'task.progress'
    taskId: number
    progress: number
}

interface WorkerEventCompleted {
    type: 'task.completed'
    taskId: number
    output: object
}

interface WorkerEventFailed {
    type: 'task.failed'
    taskId: number
    error: object
}

export type WorkerEvent =
    | WorkerEventStart
    | WorkerEventProgress
    | WorkerEventCompleted
    | WorkerEventFailed
