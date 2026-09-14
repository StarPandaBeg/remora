import { z } from 'zod/v4'

import {
    processingStatus,
    processingStepStatus,
    type TaskRun,
    type TaskStep,
} from '../../database/schema.ts'
import { taskRegistry, type TaskType } from '../../orchestrator/tasks.ts'

export interface TaskStepDto {
    id: number
    runId: number
    type: string
    status: TaskStep['status']
    position: number
    input?: unknown
    output?: unknown
    error?: unknown
    context?: unknown
    createdAt: string
    updatedAt: string
    startedAt: string | null
    finishedAt: string | null
}

export interface TaskDto {
    id: number
    entryId: number
    type: TaskType
    status: TaskRun['status']
    config: unknown
    pipelineVersion: number
    createdAt: string
    updatedAt: string
    startedAt: string | null
    finishedAt: string | null
    steps: TaskStepDto[]
}

const timestampSchema = z.iso.datetime()
const nullableTimestampSchema = timestampSchema.nullable()
const taskTypeSchema = z.enum(
    Object.keys(taskRegistry) as [TaskType, ...TaskType[]],
)

export const taskStepDtoSchema: z.ZodType<TaskStepDto> = z.object({
    id: z.number().int().positive(),
    runId: z.number().int().positive(),
    type: z.string(),
    status: z.enum(processingStepStatus.enumValues),
    position: z.number().int().min(0),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.unknown().optional(),
    context: z.unknown().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: nullableTimestampSchema,
    finishedAt: nullableTimestampSchema,
})

export const taskDtoSchema: z.ZodType<TaskDto> = z.object({
    id: z.number().int().positive(),
    entryId: z.number().int().positive(),
    type: taskTypeSchema,
    status: z.enum(processingStatus.enumValues),
    config: z.unknown(),
    pipelineVersion: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: nullableTimestampSchema,
    finishedAt: nullableTimestampSchema,
    steps: z.array(taskStepDtoSchema),
})

z.globalRegistry.add(taskStepDtoSchema, { id: 'TaskStep' })
z.globalRegistry.add(taskDtoSchema, { id: 'Task' })

function toTimestamp(value: Date | null): string | null {
    return value?.toISOString() ?? null
}

function toStepDto(step: TaskStep): TaskStepDto {
    return {
        id: step.id,
        runId: step.runId,
        type: step.type,
        status: step.status,
        position: step.position,
        input: step.input,
        context: step.context,
        output: step.output,
        error: step.error,
        createdAt: step.createdAt.toISOString(),
        updatedAt: step.updatedAt.toISOString(),
        startedAt: toTimestamp(step.startedAt),
        finishedAt: toTimestamp(step.finishedAt),
    }
}

export function toTaskDto(task: TaskRun): TaskDto {
    return {
        id: task.id,
        entryId: task.entryId,
        type: task.type,
        status: task.status,
        config: task.config,
        pipelineVersion: task.pipelineVersion,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        startedAt: toTimestamp(task.startedAt),
        finishedAt: toTimestamp(task.finishedAt),
        steps: [...(task.steps ?? [])]
            .sort((a, b) => a.position - b.position)
            .map(toStepDto),
    }
}
