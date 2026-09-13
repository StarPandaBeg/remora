import type { Folder } from '../../database/schema.ts'
import type { FolderTreeNode } from './folders.service.ts'

export interface FolderDto {
    id: number
    parentId: number | null
    name: string
    description: string | null
    depth?: number
    children?: FolderDto[]
}

export function toDto(node: Folder | FolderTreeNode): FolderDto {
    return {
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        description: node.description,

        ...('depth' in node && {
            depth: node.depth,
        }),
        ...('children' in node && {
            children: node.children.map(toDto),
        }),
    }
}
