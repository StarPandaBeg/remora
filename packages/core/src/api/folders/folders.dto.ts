import { z } from 'zod/v4'
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

export const folderDtoSchema: z.ZodType<FolderDto> = z.lazy(() =>
    z.object({
        id: z.number().int().positive(),
        parentId: z.number().int().positive().nullable(),
        name: z.string(),
        description: z.string().nullable(),
        depth: z.number().int().min(0).optional(),
        children: z.array(folderDtoSchema).optional(),
    }),
)

z.globalRegistry.add(folderDtoSchema, {
    id: 'Folder',
})

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
