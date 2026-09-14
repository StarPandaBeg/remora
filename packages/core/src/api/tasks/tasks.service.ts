import type { ProcessingStatus } from '../../database/schema.ts'
import type { Orchestrator } from '../../orchestrator/orchestrator.ts'
import type { RepositoryRegistry } from '../../repositories.ts'
import { HttpError } from '../../util/error.ts'

export interface TaskServiceDependencies {
    repositories: {
        tasks: Pick<RepositoryRegistry['tasks'], 'findTask' | 'findTasks'>
    }
    orchestrator: Pick<Orchestrator, 'runTask'>
}

export function createTaskService(dependencies: TaskServiceDependencies) {
    const getAll = async (statuses?: ProcessingStatus[]) => {
        return await dependencies.repositories.tasks.findTasks(statuses)
    }

    const getById = async (id: number) => {
        const task = await dependencies.repositories.tasks.findTask(id)

        if (!task) {
            throw new HttpError('TASK_NOT_FOUND', `Task ${id} was not found`)
        }

        return task
    }

    const start = async (id: number) => {
        const task = await getById(id)
        await dependencies.orchestrator.runTask(task)

        return await getById(id)
    }

    return {
        getAll,
        getById,
        start,
    }
}
