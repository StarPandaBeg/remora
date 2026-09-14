import type { EntryCreate } from '../../database/schema.ts'
import type {
    RepositoryRegistry,
    TransactionRunner,
} from '../../repositories.ts'
import {
    isFileEntryType,
    type FileEntryType,
} from '../../storage/entry-file-validation.ts'
import { HttpError } from '../../util/error.ts'
import { buildTree, type TreeNode } from '../../util/tree.ts'
import { createTaskService } from '../tasks/tasks.service.ts'
import type { TreeRow, UpdateEntryInput } from './entries.model.ts'
import type {
    EntryFileService,
    EntryFileUpload,
    UploadedEntryFile,
} from './entry-files.service.ts'

export type EntryTreeNode = TreeNode<TreeRow>

export interface CreateNoteInput {
    type: 'note'
    folderId: number
    name: string
    content: string
}

export interface CreateFileEntryInput {
    type: FileEntryType
    folderId: number
    name: string
    file: EntryFileUpload
}

export type CreateEntryInput = CreateNoteInput | CreateFileEntryInput

function isFileEntryInput(
    input: CreateEntryInput,
): input is CreateFileEntryInput {
    return isFileEntryType(input.type)
}

interface EntryServiceDependencies {
    files: EntryFileService
    repositories: RepositoryRegistry
    transaction: TransactionRunner
}

export function createEntryService({
    files,
    repositories,
    transaction,
}: EntryServiceDependencies) {
    const ensureEntryExists = async (id: number) => {
        const entry = await repositories.entries.findById(id)
        if (!entry) {
            throw new HttpError('ENTRY_NOT_FOUND', `Entry ${id} was not found`)
        }
        return entry
    }

    const ensureFolderExists = async (id: number) => {
        if (!(await repositories.entries.folderExists(id))) {
            throw new HttpError(
                'FOLDER_NOT_FOUND',
                `Folder ${id} was not found`,
            )
        }
    }

    const update = async (id: number, input: UpdateEntryInput) => {
        const entry = await repositories.entries.update(id, input)
        if (!entry) {
            throw new HttpError('ENTRY_NOT_FOUND', `Entry ${id} was not found`)
        }
        return entry
    }

    const persistEntry = async (
        input: EntryCreate,
        uploadedFile?: UploadedEntryFile,
    ) => {
        return await transaction(async (transactionRepositories) => {
            let entry = await transactionRepositories.entries.create(input)

            if (uploadedFile !== undefined) {
                const metadata = files.metadataForEntry(uploadedFile, entry.id)
                const entryWithFile =
                    await transactionRepositories.entries.updateMetadata(
                        entry.id,
                        metadata,
                    )
                if (entryWithFile === undefined) {
                    throw new HttpError(
                        'ENTRY_METADATA_UPDATE_FAILED',
                        `Entry ${entry.id} metadata could not be updated`,
                        500,
                    )
                }
                entry = entryWithFile
            }

            await createTaskService(
                transactionRepositories,
            ).createTasksForEntry(entry)
            return entry
        })
    }

    const create = async (input: CreateEntryInput) => {
        await ensureFolderExists(input.folderId)

        if (!isFileEntryInput(input)) return await persistEntry(input)

        return await files.uploadAndPersist(
            input.file,
            async (uploadedFile) =>
                await persistEntry(
                    {
                        type: input.type,
                        folderId: input.folderId,
                        name: input.name,
                        content: null,
                    },
                    uploadedFile,
                ),
        )
    }

    const getFile = async (id: number) => {
        const entry = await ensureEntryExists(id)
        return await files.open(entry.metadata)
    }

    const move = async (id: number, folderId: number) => {
        await ensureEntryExists(id)
        await ensureFolderExists(folderId)

        const entry = await repositories.entries.move(id, folderId)
        if (!entry) {
            throw new HttpError('ENTRY_NOT_FOUND', `Entry ${id} was not found`)
        }
        return entry
    }

    const remove = async (id: number) => {
        const entry = await repositories.entries.remove(id)
        if (!entry) {
            throw new HttpError('ENTRY_NOT_FOUND', `Entry ${id} was not found`)
        }
    }

    const getTree = async (params: {
        depth: number
        rootFolderId?: number
    }) => {
        if (params.rootFolderId !== undefined) {
            await ensureFolderExists(params.rootFolderId)
        }
        const rows = await repositories.entries.findTree(params)
        return buildTree(rows, {
            getId: (node) => `${node.entryType}:${node.id}`,
            getParentId: (node) =>
                node.parentId === null ? null : `folder:${node.parentId}`,
        })
    }

    return {
        create,
        getFile,
        getTree,
        move,
        remove,
        update,
    }
}
