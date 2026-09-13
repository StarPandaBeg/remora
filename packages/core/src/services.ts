import { createEntryService } from './api/entries/entries.service.ts'
import { createFolderService } from './api/folders/folders.service.ts'
import { createTaskService } from './api/tasks/tasks.service.ts'
import type { RepositoryRegistry, TransactionRunner } from './repositories.ts'
import type { ObjectStorage } from './storage/object-storage.ts'

export interface ServiceDependencies {
    repositories: RepositoryRegistry
    storage: ObjectStorage
    transaction: TransactionRunner
}

export function createServices(dependencies: ServiceDependencies) {
    return {
        entries: createEntryService(dependencies),
        folders: createFolderService(dependencies.repositories.folders),
        tasks: createTaskService(
            dependencies.repositories,
            dependencies.transaction,
        ),
    }
}

export type ServiceRegistry = ReturnType<typeof createServices>
