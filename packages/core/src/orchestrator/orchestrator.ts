import type { RuntimeConfig } from '../api/config/types.ts'
import type {
    Entry,
    TaskRun,
    TaskRunCreate,
    TaskStepCreate,
} from '../database/schema.ts'
import type { RepositoryRegistry, TransactionRunner } from '../repositories.ts'
import { HttpError } from '../util/error.ts'
import type { CompletionServiceFactory } from './completion-services.ts'
import { createOrchestratorEvents } from './orchestrator-events.ts'
import { taskRegistry, type TaskType } from './tasks.ts'
import type { PipelineContext } from './types.ts'
import type { Worker } from './worker.ts'

export interface RuntimeConfigProvider {
    getEffective: () => Promise<RuntimeConfig>
    withRepositories: (
        repositories: RepositoryRegistry,
        transaction?: TransactionRunner,
    ) => RuntimeConfigProvider
}

export const createOrchestrator = (
    repositories: RepositoryRegistry,
    transaction: TransactionRunner,
    worker: Pick<Worker, 'execute'>,
    runtimeConfig: RuntimeConfigProvider,
    createCompletionServices: CompletionServiceFactory,
) => {
    const dummyTransaction = (
        f: (r: RepositoryRegistry) => Promise<void>,
    ): Promise<void> => f(repositories)

    const validateApplicableTaskType = (entry: Entry, taskType: TaskType) => {
        const types = applicableTaskTypes(entry)
        if (!types.includes(taskType)) {
            throw new HttpError(
                'ENTRY_NOT_SUPPORTED',
                `Entry ${entry.id} is not supported by pipeline ${taskType}`,
            )
        }
    }

    const applicableTaskTypes = (entry: Entry) =>
        (Object.keys(taskRegistry) as TaskType[]).filter((type) =>
            taskRegistry[type].canUseEntry(entry),
        )

    const canProcessEntry = (entry: Entry) => {
        return applicableTaskTypes(entry).length > 0
    }

    const createTaskForEntry = async (
        entry: Entry,
        taskType: TaskType,
        useTransaction = true,
    ) => {
        validateApplicableTaskType(entry, taskType)
        const taskDef = taskRegistry[taskType]

        const wrapper = useTransaction ? transaction : dummyTransaction

        let task: TaskRun
        await wrapper(async (repositories) => {
            const effectiveConfig = await runtimeConfig
                .withRepositories(repositories)
                .getEffective()
            const taskData: TaskRunCreate = {
                type: taskType,
                entryId: entry.id,
                status: 'pending',
                pipelineVersion: 1,
                config: taskDef.selectConfig(effectiveConfig),
            }
            task = await repositories.tasks.createTask(taskData)
            const ctx = await taskDef.buildContext(entry)

            for (let i = 0; i < taskDef.pipeline.length; i++) {
                const step = taskDef.pipeline[i]
                const context = i == 0 ? ctx : undefined

                const stepData: TaskStepCreate = {
                    runId: task.id,
                    type: step.type,
                    position: i,
                    context,
                }
                await repositories.tasks.createStep(stepData)
            }
        })
        return task!
    }

    const runTask = async (task: TaskRun, useTransaction = true) => {
        const wrapper = useTransaction ? transaction : dummyTransaction
        if (task.status != 'pending') {
            throw new HttpError(
                'TASK_CANNOT_BE_RUNNED',
                'You can run only pending tasks',
                409,
            )
        }

        await wrapper(async (repositories) => {
            await repositories.tasks.startTask(task.id)
        })
        await runNextStep(task.id)
    }

    const runNextStep = async (taskId: number) => {
        const task = (await repositories.tasks.findTask(taskId))!
        const taskDef = taskRegistry[task.type]

        if (task.status != 'running') {
            throw new HttpError(
                'STEP_CANNOT_BE_RUNNED',
                'You can run only steps of running tasks',
            )
        }

        const nextStep = getNextAvailableStep(task)
        if (nextStep == null) {
            throw new HttpError(
                'STEP_NOT_FOUND',
                'There are no next steps to run',
            )
        }
        if (nextStep.context == null) {
            throw new HttpError(
                'STEP_CONTEXT_MISSING',
                `Step ${nextStep.id} has no context`,
            )
        }

        const stepDef = taskDef.pipeline.find((s) => s.type == nextStep.type)
        if (stepDef == null) {
            throw new HttpError(
                'STEP_INVALID',
                'Database corrupted: invalid step found',
            )
        }

        const input = await stepDef.buildInput(
            nextStep.context as PipelineContext,
        )
        await repositories.tasks.enqueueStep(nextStep.id, input)

        try {
            await worker.execute({
                pipeline: task.type,
                type: nextStep.type,
                taskId: nextStep.id,
                input: { ...input },
                config: { ...(task.config ?? {}) },
            })
        } catch (error) {
            const workerError = {
                code: 'WORKER_EXECUTE_FAILED',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Unknown worker execution error',
            }

            try {
                await transaction(async (repositories) => {
                    await repositories.tasks.haltStep(nextStep.id, workerError)
                    await repositories.tasks.haltTask(task.id)
                })
            } catch (updateError) {
                throw new AggregateError(
                    [error, updateError],
                    `Worker execution failed and task ${task.id} could not be marked as failed`,
                    { cause: updateError },
                )
            }
        }
    }

    /** Возвращаем следующий шаг, доступный для запуска
     *
     * Условия:
     * * Если пайплайн уже содержит запущенные задачи - вернет null
     * * Если пайплайн завершился неудачно - вернет null
     * * Если пайплайн завершился полностью - вернет null
     * * Если ни одной задачи еще не запускалось - вернет самый первый шаг
     * * Иначе - вернет первую blocked задачу после completed
     */
    const getNextAvailableStep = (task: TaskRun) => {
        const steps = task.steps!.toSorted((a, b) => a.position - b.position)
        const busy = steps.some(
            (s) => s.status === 'running' || s.status === 'queued',
        )
        if (busy) return null
        return (
            steps.find((step, index) => {
                if (step.status !== 'blocked') return false
                if (index === 0) return true
                return steps[index - 1]?.status === 'completed'
            }) ?? null
        )
    }

    const { handleWorkerEvent } = createOrchestratorEvents({
        repositories,
        transaction,
        runNextStep,
        createCompletionServices,
    })

    const withRepositories = (
        repositories: RepositoryRegistry,
        transaction_?: TransactionRunner,
    ) => {
        const nextTransaction = transaction_ ?? transaction
        return createOrchestrator(
            repositories,
            nextTransaction,
            worker,
            runtimeConfig.withRepositories(repositories, nextTransaction),
            createCompletionServices,
        )
    }

    return {
        createTaskForEntry,
        applicableTaskTypes,
        canProcessEntry,
        withRepositories,
        runNextStep,
        runTask,
        handleWorkerEvent,
    }
}

export type Orchestrator = ReturnType<typeof createOrchestrator>
