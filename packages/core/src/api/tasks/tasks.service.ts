import type {
    Entry,
    TaskRun,
    TaskRunCreate,
    TaskStepCreate,
} from '../../database/schema.ts'
import { taskRegistry, type TaskType } from '../../orchestrator/task.ts'
import type {
    RepositoryRegistry,
    TransactionRunner,
} from '../../repositories.ts'
import { HttpError } from '../../util/error.ts'

export function createTaskService(
    repositories: RepositoryRegistry,
    transaction?: TransactionRunner,
) {
    const createTaskWithoutTransaction = async (
        entryId: number,
        type: TaskType,
    ) => {
        const entry = await repositories.entries.findById(entryId)
        if (entry == null) {
            throw new HttpError(
                'ENTRY_NOT_FOUND',
                `Entry ${entryId} was not found`,
            )
        }
        const taskDef = taskRegistry[type]
        if (!taskDef || !taskDef.canUseEntry(entry)) {
            throw new HttpError(
                'ENTRY_NOT_SUPPORTED',
                `Entry ${entryId} is not supported by pipeline ${type}`,
            )
        }

        const taskData: TaskRunCreate = {
            type,
            entryId,
            status: 'pending',
            pipelineVersion: 1,
        }

        const task = await repositories.tasks.createTask(taskData)

        for (let i = 0; i < taskDef.pipeline.length; i++) {
            const stepName = taskDef.pipeline[i]
            const stepData: TaskStepCreate = {
                runId: task.id,
                type: stepName,
                position: i,
            }
            await repositories.tasks.createStep(stepData)
        }

        return task
    }

    const createTask = async (
        entryId: number,
        type: TaskType,
    ): Promise<TaskRun> =>
        transaction === undefined
            ? await createTaskWithoutTransaction(entryId, type)
            : await transaction(
                  async (transactionRepositories) =>
                      await createTaskService(
                          transactionRepositories,
                      ).createTask(entryId, type),
              )

    const canProcessEntry = (entry: Entry) => {
        for (const taskDef of Object.values(taskRegistry)) {
            if (taskDef.canUseEntry(entry)) return true
        }
        return false
    }

    return { createTask, canProcessEntry }
}
