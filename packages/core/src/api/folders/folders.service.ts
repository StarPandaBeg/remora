import type { Folder } from '../../database/schema.ts'
import { buildTree } from '../../util/tree.ts'
import type { createFolderRepository } from './folders.model.ts'

export type FolderTreeNode = Folder & {
    depth: number
    children: FolderTreeNode[]
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

    return {
        getTree,
    }
}
