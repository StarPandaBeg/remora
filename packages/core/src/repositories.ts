import { createRuntimeConfigRepository } from './api/config/config.model.ts'
import { createEntryRepository } from './api/entries/entries.model.ts'
import { createEntryArtifactRepository } from './api/entries/entry-artifacts.model.ts'
import { createFolderRepository } from './api/folders/folders.model.ts'
import { createTaskRepository } from './api/tasks/tasks.model.ts'
import type { AppDatabase, DbExecutor } from './database/index.ts'

export interface RepositoryRegistry {
    config: ReturnType<typeof createRuntimeConfigRepository>
    entries: ReturnType<typeof createEntryRepository>
    entryArtifacts: ReturnType<typeof createEntryArtifactRepository>
    folders: ReturnType<typeof createFolderRepository>
    tasks: ReturnType<typeof createTaskRepository>
    withDb: (db: DbExecutor) => RepositoryRegistry
}

export function createRepositories(db: DbExecutor): RepositoryRegistry {
    return {
        config: createRuntimeConfigRepository(db),
        entries: createEntryRepository(db),
        entryArtifacts: createEntryArtifactRepository(db),
        folders: createFolderRepository(db),
        tasks: createTaskRepository(db),
        withDb: createRepositories,
    }
}

export type TransactionRunner = <T>(
    work: (repositories: RepositoryRegistry) => Promise<T>,
) => Promise<T>

export function createTransactionRunner(
    db: AppDatabase,
    repositories: RepositoryRegistry,
): TransactionRunner {
    return async (work) =>
        await db.transaction(
            async (transaction) => await work(repositories.withDb(transaction)),
        )
}
