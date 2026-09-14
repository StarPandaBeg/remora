import type { Entry, ProcessingStepStatus } from '../database/schema.ts'

export type PipelineContext = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PipelineAny = StepDefinition<any, object, any>[]
export type WorkerConfig = Record<string, unknown>

export interface WorkerSubmitDto<I> {
    type: string
    taskId: number
    config: WorkerConfig
    input: I
}

export interface TaskDefinition {
    type: string
    pipeline: PipelineAny
    canUseEntry: (entry: Entry) => boolean
    buildContext: (entry: Entry) => Promise<PipelineContext>
}

export interface StepDefinition<C extends PipelineContext, I, O> {
    type: string

    buildInput: (ctx: C) => Promise<I>
    validateOutput: (output: unknown) => Promise<O>
    updateContext: (ctx: C, output: O) => Promise<C>
}

export interface Worker {
    submit: <I>(data: WorkerSubmitDto<I>) => Promise<void>
    cancel: (taskId: number) => Promise<{ status: ProcessingStepStatus }>
}
