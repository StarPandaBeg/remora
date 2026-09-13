import type { Folder } from '../../database/schema.ts'
import { buildTree } from '../../util/tree.ts'
import type {
    CreateFolderInput,
    createFolderRepository,
    UpdateFolderInput,
} from './folders.model.ts'

export type FolderTreeNode = Folder & {
    depth: number
    children: FolderTreeNode[]
}

export class FolderServiceError extends Error {
    readonly code: string
    readonly statusCode: 404 | 409

    constructor(code: string, message: string, statusCode: 404 | 409) {
        super(message)
        this.name = 'FolderServiceError'
        this.code = code
        this.statusCode = statusCode
    }
}

export function createFolderService(
    repository: ReturnType<typeof createFolderRepository>,
) {
    const getTree = async (params: { depth: number; rootId?: number }) => {
        const rows = await repository.findTree(params)
        return buildTree(rows, {
            getId: (folder) => folder.id,
            getParentId: (folder) => folder.parentId,
        })
    }

    const ensureFolderExists = async (id: number, role = 'Folder') => {
        const folder = await repository.findById(id)

        if (!folder) {
            throw new FolderServiceError(
                'FOLDER_NOT_FOUND',
                `${role} ${id} was not found`,
                404,
            )
        }

        return folder
    }

    const create = async (input: CreateFolderInput) => {
        if (input.parentId != null) {
            await ensureFolderExists(input.parentId, 'Parent folder')
        }

        return await repository.create({
            ...input,
            parentId: input.parentId ?? null,
        })
    }

    const update = async (id: number, input: UpdateFolderInput) => {
        const folder = await repository.update(id, input)

        if (!folder) {
            throw new FolderServiceError(
                'FOLDER_NOT_FOUND',
                `Folder ${id} was not found`,
                404,
            )
        }

        return folder
    }

    const move = async (id: number, parentId: number | null) => {
        await ensureFolderExists(id)

        if (parentId !== null) {
            if (parentId === id || (await repository.contains(id, parentId))) {
                throw new FolderServiceError(
                    'FOLDER_MOVE_CYCLE',
                    'A folder cannot be moved into itself or its descendant',
                    409,
                )
            }

            await ensureFolderExists(parentId, 'Parent folder')
        }

        return await repository.move(id, parentId)
    }

    const remove = async (id: number) => {
        const folder = await repository.remove(id)

        if (!folder) {
            throw new FolderServiceError(
                'FOLDER_NOT_FOUND',
                `Folder ${id} was not found`,
                404,
            )
        }
    }

    return {
        create,
        getTree,
        move,
        remove,
        update,
    }
}
