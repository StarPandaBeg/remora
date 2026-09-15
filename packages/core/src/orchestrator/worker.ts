import type { JsonObject } from '../types/json.ts'
import type { TaskType } from './tasks.ts'

interface WorkerEventStart {
    type: 'task.started'
    taskId: number
}

interface WorkerEventProgress {
    type: 'task.progress'
    taskId: number
    progress: number
    totalSteps?: number
    step?: number
    stepName?: string
    stepProgress?: number
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

export interface WorkerTaskCommand {
    pipeline: TaskType
    type: string
    taskId: number
    input: Record<string, unknown>
    config: JsonObject
}

export const workerEventCallbackPath = '/v1/tasks/events'
const workerExecutePath = '/tasks/execute'

type Fetch = typeof globalThis.fetch

export interface WorkerDependencies {
    publicBaseUrl: string
    workerUrl: string
    requestTimeoutMs: number
    fetch?: Fetch
}

export class WorkerRequestError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'WorkerRequestError'
    }
}

function isAcceptedResponse(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Reflect.get(value, 'accepted') === true
    )
}

export function createWorker({
    publicBaseUrl,
    workerUrl,
    requestTimeoutMs,
    fetch: fetch_ = globalThis.fetch,
}: WorkerDependencies) {
    const callbackUrl = `${publicBaseUrl}${workerEventCallbackPath}`
    const executeUrl = `${workerUrl}${workerExecutePath}`

    const execute = async (command: WorkerTaskCommand): Promise<void> => {
        const signal = AbortSignal.timeout(requestTimeoutMs)
        let response: Response
        const { pipeline, type, taskId, input, config } = command

        try {
            response = await fetch_(executeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pipeline,
                    type,
                    taskId,
                    callbackUrl,
                    input,
                    config,
                }),
                signal,
            })
        } catch (error) {
            if (signal.aborted) {
                throw new WorkerRequestError(
                    `Worker request timed out after ${requestTimeoutMs}ms`,
                    { cause: error },
                )
            }

            throw new WorkerRequestError('Worker request failed', {
                cause: error,
            })
        }

        if (response.status !== 202) {
            throw new WorkerRequestError(
                `Worker returned unexpected HTTP status ${response.status}`,
            )
        }

        let result: unknown
        try {
            result = await response.json()
        } catch (error) {
            throw new WorkerRequestError('Worker returned invalid JSON', {
                cause: error,
            })
        }

        if (!isAcceptedResponse(result)) {
            throw new WorkerRequestError(
                'Worker returned an unexpected response body',
            )
        }
    }

    return { execute }
}

export type Worker = ReturnType<typeof createWorker>
