import type { RuntimeConfigService } from './api/config/config.ts'
import { createEntryService } from './api/entries/entries.service.ts'
import { createEntryFileService } from './api/entries/entry-files.service.ts'
import { createFolderService } from './api/folders/folders.service.ts'
import { createTaskService } from './api/tasks/tasks.service.ts'
import { createCompletionServices } from './orchestrator/completion-services.ts'
import type { Orchestrator } from './orchestrator/orchestrator.ts'
import type { RepositoryRegistry, TransactionRunner } from './repositories.ts'
import type { ObjectStorage } from './storage/object-storage.ts'

export interface ServiceDependencies {
    publicBaseUrl: string
    repositories: RepositoryRegistry
    storage: ObjectStorage
    transaction: TransactionRunner
    orchestrator: Orchestrator
    runtimeConfig: RuntimeConfigService
}

export function createServices(dependencies: ServiceDependencies) {
    const files = createEntryFileService({
        publicBaseUrl: dependencies.publicBaseUrl,
        storage: dependencies.storage,
    })
    const completionServices = createCompletionServices(
        dependencies.repositories,
    )

    return {
        config: dependencies.runtimeConfig,
        entries: createEntryService({
            files,
            repositories: dependencies.repositories,
            transaction: dependencies.transaction,
            orchestrator: dependencies.orchestrator,
        }),
        entryArtifacts: completionServices.entryArtifacts,
        files,
        folders: createFolderService(dependencies.repositories.folders),
        tasks: createTaskService({
            repositories: dependencies.repositories,
            orchestrator: dependencies.orchestrator,
        }),
    }
}

export type ServiceRegistry = ReturnType<typeof createServices>
