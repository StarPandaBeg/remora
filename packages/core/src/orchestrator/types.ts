import type { RuntimeConfig } from '../api/config/types.ts'
import type { Entry } from '../database/schema.ts'
import type { RepositoryRegistry } from '../repositories.ts'
import type { JsonObject } from '../types/json.ts'
import type { CompletionServiceRegistry } from './completion-services.ts'

export type PipelineContext = Record<string, unknown>
export type PipelineAny = StepDefinition<PipelineContext, object, unknown>[]

export interface PipelineCompletionDependencies {
    repositories: RepositoryRegistry
    services: CompletionServiceRegistry
}

export interface TaskDefinition {
    type: string
    pipeline: PipelineAny
    canUseEntry: (entry: Entry) => boolean
    buildContext: (entry: Entry) => Promise<PipelineContext>
    selectConfig: (config: RuntimeConfig) => JsonObject

    onCompleted?(
        ctx: PipelineContext,
        dependencies: PipelineCompletionDependencies,
    ): Promise<void>
}

export interface StepDefinition<C extends PipelineContext, I, O> {
    type: string

    buildInput(ctx: C): Promise<I>
    validateOutput(output: unknown): Promise<O>
    updateContext(ctx: C, output: O): Promise<C>

    onCompleted?(
        ctx: C,
        dependencies: PipelineCompletionDependencies,
    ): Promise<void>
}

export type { Worker, WorkerTaskCommand } from './worker.ts'
