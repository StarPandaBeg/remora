import type { RepositoryRegistry } from '../../repositories.ts'
import { HttpError } from '../../util/error.ts'
import type {
    CreateEntryArtifactInput,
    UpdateEntryArtifactContentInput,
    UpdateTextEntryArtifactInput,
} from './entry-artifacts.model.ts'

export interface EntryArtifactServiceDependencies {
    repositories: {
        entries: Pick<RepositoryRegistry['entries'], 'findById'>
        entryArtifacts: RepositoryRegistry['entryArtifacts']
    }
}

export function createEntryArtifactService({
    repositories,
}: EntryArtifactServiceDependencies) {
    const getById = async (id: number) => {
        const artifact = await repositories.entryArtifacts.findById(id)
        if (!artifact) {
            throw new HttpError(
                'ENTRY_ARTIFACT_NOT_FOUND',
                `Entry artifact ${id} was not found`,
            )
        }
        return artifact
    }

    const getForEntry = async (entryId: number) => {
        const entry = await repositories.entries.findById(entryId)
        if (!entry) {
            throw new HttpError(
                'ENTRY_NOT_FOUND',
                `Entry ${entryId} was not found`,
            )
        }
        return await repositories.entryArtifacts.findByEntryId(entryId)
    }

    const create = async (input: CreateEntryArtifactInput) => {
        const entry = await repositories.entries.findById(input.entryId)
        if (!entry) {
            throw new HttpError(
                'ENTRY_NOT_FOUND',
                `Entry ${input.entryId} was not found`,
            )
        }
        return await repositories.entryArtifacts.create(input)
    }

    const updateContentAndMetadata = async (
        id: number,
        input: UpdateEntryArtifactContentInput,
    ) => {
        const artifact =
            await repositories.entryArtifacts.updateContentAndMetadata(
                id,
                input,
            )
        if (!artifact) {
            throw new HttpError(
                'ENTRY_ARTIFACT_NOT_FOUND',
                `Entry artifact ${id} was not found`,
            )
        }
        return artifact
    }

    const updateText = async (
        id: number,
        input: UpdateTextEntryArtifactInput,
    ) => {
        const current = await getById(id)
        if (current.format !== 'text') {
            throw new HttpError(
                'ENTRY_ARTIFACT_NOT_TEXT',
                `Entry artifact ${id} is not a text artifact`,
                409,
            )
        }

        const artifact = await repositories.entryArtifacts.updateText(id, input)
        if (!artifact) {
            throw new HttpError(
                'ENTRY_ARTIFACT_NOT_FOUND',
                `Entry artifact ${id} was not found`,
            )
        }
        return artifact
    }

    return {
        create,
        getById,
        getForEntry,
        updateContentAndMetadata,
        updateText,
    }
}

export type EntryArtifactService = ReturnType<typeof createEntryArtifactService>
