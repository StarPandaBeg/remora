import { createEntryStatusService } from '../api/entries/entries.service.ts'
import { createEntryArtifactService } from '../api/entries/entry-artifacts.service.ts'
import type { RepositoryRegistry } from '../repositories.ts'

export function createCompletionServices(repositories: RepositoryRegistry) {
    return {
        entries: createEntryStatusService(repositories.entries),
        entryArtifacts: createEntryArtifactService({ repositories }),
    }
}

export type CompletionServiceRegistry = ReturnType<
    typeof createCompletionServices
>

export type CompletionServiceFactory = typeof createCompletionServices
