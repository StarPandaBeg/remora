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
    const createTaskForEntry = async (entry: Entry, type: TaskType) => {
        const taskDef = taskRegistry[type]
        if (!taskDef || !taskDef.canUseEntry(entry)) {
            throw new HttpError(
                'ENTRY_NOT_SUPPORTED',
                `Entry ${entry.id} is not supported by pipeline ${type}`,
            )
        }

        const taskData: TaskRunCreate = {
            type,
            entryId: entry.id,
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
        return await createTaskForEntry(entry, type)
    }

    const applicableTaskTypes = (entry: Entry) =>
        (Object.keys(taskRegistry) as TaskType[]).filter((type) =>
            taskRegistry[type].canUseEntry(entry),
        )

    const createTasksForEntryWithoutTransaction = async (entry: Entry) => {
        const tasks: TaskRun[] = []
        for (const type of applicableTaskTypes(entry)) {
            tasks.push(await createTaskForEntry(entry, type))
        }
        return tasks
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
        return applicableTaskTypes(entry).length > 0
    }

    const createTasksForEntry = async (entry: Entry): Promise<TaskRun[]> =>
        transaction === undefined
            ? await createTasksForEntryWithoutTransaction(entry)
            : await transaction(
                  async (transactionRepositories) =>
                      await createTaskService(
                          transactionRepositories,
                      ).createTasksForEntry(entry),
              )

    return { createTask, createTasksForEntry, canProcessEntry }
}
