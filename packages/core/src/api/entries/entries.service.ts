import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'

import type { EntryCreate, EntryMetadata } from '../../database/schema.ts'
import type {
    RepositoryRegistry,
    TransactionRunner,
} from '../../repositories.ts'
import {
    StorageCompensationError,
    type ObjectStorage,
} from '../../storage/object-storage.ts'
import { HttpError } from '../../util/error.ts'
import { buildTree, type TreeNode } from '../../util/tree.ts'
import { createTaskService } from '../tasks/tasks.service.ts'
import type { TreeRow, UpdateEntryInput } from './entries.model.ts'

export type EntryTreeNode = TreeNode<TreeRow>

export interface CreateNoteInput {
    type: 'note'
    folderId: number
    name: string
    content: string
}

export interface CreateVideoInput {
    type: 'video_record'
    folderId: number
    name: string
    video: {
        body: Readable
        extension: string
        mimeType: string
        originalName: string
        size: number
    }
}

export type CreateEntryInput = CreateNoteInput | CreateVideoInput

interface EntryServiceDependencies {
    repositories: RepositoryRegistry
    storage: ObjectStorage
    transaction: TransactionRunner
    createId?: () => string
}

export function createEntryService({
    repositories,
    storage,
    transaction,
    createId = randomUUID,
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

    const createNote = async (input: CreateNoteInput) => {
        await ensureFolderExists(input.folderId)
        return await repositories.entries.create(input)
    }

    const createVideo = async (input: CreateVideoInput) => {
        await ensureFolderExists(input.folderId)

        const objectKey = `entries/video/${createId()}/original${input.video.extension}`
        const reference = await storage.putObject({
            objectKey,
            body: input.video.body,
            size: input.video.size,
            contentType: input.video.mimeType,
        })
        const metadata: EntryMetadata = {
            originalVideo: {
                ...reference,
                mimeType: input.video.mimeType,
                originalName: input.video.originalName,
                size: input.video.size,
            },
        }

        try {
            return await transaction(async (transactionRepositories) => {
                const entryData: EntryCreate = {
                    type: input.type,
                    folderId: input.folderId,
                    name: input.name,
                    content: null,
                    metadata,
                }
                const entry =
                    await transactionRepositories.entries.create(entryData)
                await createTaskService(transactionRepositories).createTask(
                    entry.id,
                    'video_record_summary',
                )
                return entry
            })
        } catch (operationError) {
            try {
                await storage.removeObject(reference)
            } catch (cleanupError) {
                throw new StorageCompensationError(
                    operationError,
                    cleanupError,
                    reference,
                )
            }
            throw operationError
        }
    }

    const create = async (input: CreateEntryInput) =>
        input.type === 'note'
            ? await createNote(input)
            : await createVideo(input)

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
        getTree,
        move,
        remove,
        update,
    }
}
