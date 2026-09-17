import type { RepositoryRegistry, TransactionRunner } from '../repositories.ts'
import { HttpError } from '../util/error.ts'
import { globalEventBus } from '../util/event.ts'
import type { CompletionServiceFactory } from './completion-services.ts'
import { taskRegistry } from './tasks.ts'
import type { PipelineContext } from './types.ts'
import type { WorkerEvent } from './worker.ts'

interface OrchestratorEventDependencies {
    repositories: RepositoryRegistry
    transaction: TransactionRunner
    runNextStep: (taskId: number) => Promise<void>
    createCompletionServices: CompletionServiceFactory
}

export const createOrchestratorEvents = ({
    repositories,
    transaction,
    runNextStep,
    createCompletionServices,
}: OrchestratorEventDependencies) => {
    const handleTaskStarted = async (
        event: Extract<WorkerEvent, { type: 'task.started' }>,
    ) => {
        const step = await repositories.tasks.findStep(event.taskId)
        if (!step) {
            throw new HttpError(
                'STEP_NOT_FOUND',
                `Step ${event.taskId} not found`,
            )
        }
        if (step.status == 'running') return
        if (step.status !== 'queued') {
            throw new HttpError(
                'STEP_INVALID_STATE',
                `Step ${step.id} cannot be started from ${step.status}`,
            )
        }
        await repositories.tasks.updateStepStatus(step.id, 'running')
    }

    const handleTaskFailed = async (
        event: Extract<WorkerEvent, { type: 'task.failed' }>,
    ) => {
        const step = await repositories.tasks.findStep(event.taskId)
        if (!step) {
            throw new HttpError(
                'STEP_NOT_FOUND',
                `Step ${event.taskId} not found`,
            )
        }
        if (step.status == 'failed') return
        if (step.status !== 'queued' && step.status !== 'running') {
            throw new HttpError(
                'STEP_INVALID_STATE',
                `Step ${step.id} is not running`,
            )
        }
        await transaction(async (repositories) => {
            await repositories.tasks.haltStep(step.id, event.error)
            await repositories.tasks.haltTask(step.runId)
        })
    }

    const handleTaskCompleted = async (
        event: Extract<WorkerEvent, { type: 'task.completed' }>,
    ) => {
        const step = await repositories.tasks.findStep(event.taskId)
        if (!step) {
            throw new HttpError(
                'STEP_NOT_FOUND',
                `Step ${event.taskId} not found`,
            )
        }
        if (step.status == 'completed') return
        if (step.status !== 'running') {
            throw new HttpError(
                'STEP_INVALID_STATE',
                `Step ${step.id} is not running`,
            )
        }
        const task = await repositories.tasks.findTask(step.runId)
        if (!task) {
            throw new HttpError(
                'TASK_NOT_FOUND',
                `Task ${step.runId} not found`,
            )
        }

        const taskDef = taskRegistry[task.type]
        const stepDef = taskDef.pipeline.find((s) => s.type == step.type)

        if (!stepDef) {
            throw new HttpError(
                'STEP_INVALID',
                `Step definition ${step.type} not found`,
            )
        }

        const output = await stepDef.validateOutput(event.output)
        const ctx = await stepDef.updateContext(
            step.context as PipelineContext,
            output,
        )

        const nextStep = task.steps
            .toSorted((a, b) => a.position - b.position)
            .find((s) => s.position === step.position + 1)
        await transaction(async (repositories) => {
            const completionDependencies = {
                repositories,
                services: createCompletionServices(repositories),
            }

            await stepDef.onCompleted?.(ctx, completionDependencies)
            await repositories.tasks.finishStep(step.id, output as object)

            if (nextStep) {
                await repositories.tasks.setStepContext(nextStep.id, ctx)
            } else {
                await repositories.tasks.finishTask(task.id)
                await taskDef.onCompleted?.(ctx, completionDependencies)
            }
        })

        if (nextStep) {
            await runNextStep(task.id)
        }
    }

    const handleWorkerEvent = async (event: WorkerEvent) => {
        switch (event.type) {
            case 'task.started':
                await handleTaskStarted(event)
                break
            case 'task.failed':
                await handleTaskFailed(event)
                break
            case 'task.completed':
                await handleTaskCompleted(event)
                break
        }
        globalEventBus.emit('worker:event', event)
    }

    return { handleWorkerEvent }
}
