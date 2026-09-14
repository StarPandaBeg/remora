import type {
    Entry,
    TaskRun,
    TaskRunCreate,
    TaskStepCreate,
} from '../database/schema.ts'
import type { RepositoryRegistry, TransactionRunner } from '../repositories.ts'
import { HttpError } from '../util/error.ts'
import { taskRegistry, type TaskType } from './tasks.ts'
import type { Worker, WorkerEvent } from './worker.ts'

export const createOrchestrator = (
    repositories: RepositoryRegistry,
    transaction: TransactionRunner,
    worker: Pick<Worker, 'execute'>,
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
        const taskData: TaskRunCreate = {
            type: taskType,
            entryId: entry.id,
            status: 'pending',
            pipelineVersion: 1,
        }

        const wrapper = useTransaction ? transaction : dummyTransaction

        let task: TaskRun
        await wrapper(async (repositories) => {
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

        const input = await stepDef.buildInput(nextStep.context)
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
    }

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
        const ctx = await stepDef.updateContext(step.context, output)

        const nextStep = task.steps
            .toSorted((a, b) => a.position - b.position)
            .find((s) => s.position === step.position + 1)
        await transaction(async (repositories) => {
            await repositories.tasks.finishStep(step.id, output as object)

            if (nextStep) {
                await repositories.tasks.setStepContext(
                    nextStep.id,
                    ctx as object,
                )
            } else {
                await repositories.tasks.finishTask(task.id)
            }
        })

        if (nextStep) {
            await runNextStep(task.id)
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

    const withRepositories = (
        repositories: RepositoryRegistry,
        transaction_?: TransactionRunner,
    ) => createOrchestrator(repositories, transaction_ ?? transaction, worker)

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
