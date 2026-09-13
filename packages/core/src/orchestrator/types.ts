import type { Entry, ProcessingStepStatus } from '../database/schema.ts'

export type PipelineContext = Record<string, unknown>
export type WorkerConfig = Record<string, unknown>

export interface WorkerSubmitDto<I> {
    type: string
    taskId: number
    config: WorkerConfig
    input: I
}

export interface TaskDefinition {
    type: string
    pipeline: string[]
    canUseEntry: (entry: Entry) => boolean
}

export interface StepDefinition<C, I, O> {
    type: string

    buildInput: (ctx: C) => Promise<I>
    validateOutput: (output: unknown) => Promise<O>
    updateContext: (ctx: C, out: O) => Promise<C>
}

export interface Worker {
    submit: <I>(data: WorkerSubmitDto<I>) => Promise<void>
    cancel: (taskId: number) => Promise<{ status: ProcessingStepStatus }>
}
