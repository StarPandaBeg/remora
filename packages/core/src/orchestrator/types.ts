import type { RuntimeConfig } from '../api/config/types.ts'
import type { Entry } from '../database/schema.ts'
import type { JsonObject } from '../types/json.ts'

export type PipelineContext = Record<string, unknown>
export type PipelineAny = StepDefinition<PipelineContext, object, unknown>[]

export interface TaskDefinition {
    type: string
    pipeline: PipelineAny
    canUseEntry: (entry: Entry) => boolean
    buildContext: (entry: Entry) => Promise<PipelineContext>
    selectConfig: (config: RuntimeConfig) => JsonObject
}

export interface StepDefinition<C extends PipelineContext, I, O> {
    type: string

    buildInput(ctx: C): Promise<I>
    validateOutput(output: unknown): Promise<O>
    updateContext(ctx: C, output: O): Promise<C>
}

export type { Worker, WorkerTaskCommand } from './worker.ts'
