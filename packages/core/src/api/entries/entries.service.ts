import { buildTree, type TreeNode } from '../../util/tree.ts'
import type {
    CreateEntryInput,
    createEntryRepository,
    TreeRow,
    UpdateEntryInput,
} from './entries.model.ts'

export type EntryTreeNode = TreeNode<TreeRow>

export class EntryServiceError extends Error {
    readonly code: string
    readonly statusCode: 404

    constructor(code: string, message: string) {
        super(message)
        this.name = 'EntryServiceError'
        this.code = code
        this.statusCode = 404
    }
}

export function createEntryService(
    repository: ReturnType<typeof createEntryRepository>,
) {
    const ensureEntryExists = async (id: number) => {
        const entry = await repository.findById(id)

        if (!entry) {
            throw new EntryServiceError(
                'ENTRY_NOT_FOUND',
                `Entry ${id} was not found`,
            )
        }

        return entry
    }

    const ensureFolderExists = async (id: number) => {
        if (!(await repository.folderExists(id))) {
            throw new EntryServiceError(
                'FOLDER_NOT_FOUND',
                `Folder ${id} was not found`,
            )
        }
    }

    const update = async (id: number, input: UpdateEntryInput) => {
        const entry = await repository.update(id, input)

        if (!entry) {
            throw new EntryServiceError(
                'ENTRY_NOT_FOUND',
                `Entry ${id} was not found`,
            )
        }

        return entry
    }

    const create = async (input: CreateEntryInput) => {
        await ensureFolderExists(input.folderId)
        return await repository.create(input)
    }

    const move = async (id: number, folderId: number) => {
        await ensureEntryExists(id)
        await ensureFolderExists(folderId)

        const entry = await repository.move(id, folderId)

        if (!entry) {
            throw new EntryServiceError(
                'ENTRY_NOT_FOUND',
                `Entry ${id} was not found`,
            )
        }

        return entry
    }

    const remove = async (id: number) => {
        const entry = await repository.remove(id)

        if (!entry) {
            throw new EntryServiceError(
                'ENTRY_NOT_FOUND',
                `Entry ${id} was not found`,
            )
        }
    }

    const getTree = async (params: {
        depth: number
        rootFolderId?: number
    }) => {
        if (params.rootFolderId !== undefined) {
            await ensureFolderExists(params.rootFolderId)
        }

        const rows = await repository.findTree(params)

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
