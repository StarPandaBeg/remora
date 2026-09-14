import { z } from 'zod/v4'

import type { Entry, EntryMetadata } from '../../database/schema.ts'
import type { EntryTreeNode } from './entries.service.ts'

export interface EntryDto {
    id: number
    folderId: number
    name: string
    type: Entry['type']
    content: string | null
    metadata: EntryMetadata
}

export type EntryTreeDto =
    | {
          entryType: 'folder'
          id: number
          parentId: number | null
          name: string
          description: string | null
          depth: number
          children: EntryTreeDto[]
      }
    | {
          entryType: 'entry'
          id: number
          parentId: number
          name: string
          type: Entry['type']
          content: string | null
          metadata: EntryMetadata
          depth: number
      }

export const entryDtoSchema: z.ZodType<EntryDto> = z.object({
    id: z.number().int().positive(),
    folderId: z.number().int().positive(),
    name: z.string(),
    type: z.enum(['note', 'video_record', 'file']),
    content: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
})

export const entryTreeDtoSchema: z.ZodType<EntryTreeDto> = z.lazy(() =>
    z.discriminatedUnion('entryType', [
        z.object({
            entryType: z.literal('folder'),
            id: z.number().int().positive(),
            parentId: z.number().int().positive().nullable(),
            name: z.string(),
            description: z.string().nullable(),
            depth: z.number().int().min(0),
            children: z.array(entryTreeDtoSchema),
        }),
        z.object({
            entryType: z.literal('entry'),
            id: z.number().int().positive(),
            parentId: z.number().int().positive(),
            name: z.string(),
            type: z.enum(['note', 'video_record', 'file']),
            content: z.string().nullable(),
            metadata: z.record(z.string(), z.unknown()),
            depth: z.number().int().min(0),
        }),
    ]),
)

z.globalRegistry.add(entryDtoSchema, { id: 'Entry' })
z.globalRegistry.add(entryTreeDtoSchema, { id: 'EntryTreeNode' })

export function toEntryDto(entry: Entry): EntryDto {
    return {
        id: entry.id,
        folderId: entry.folderId,
        name: entry.name,
        type: entry.type,
        content: entry.content,
        metadata: entry.metadata,
    }
}

export function toEntryTreeDto(node: EntryTreeNode): EntryTreeDto {
    if (node.entryType === 'entry') {
        return {
            entryType: node.entryType,
            id: node.id,
            parentId: node.parentId,
            name: node.name,
            type: node.type,
            content: node.content,
            metadata: node.metadata,
            depth: node.depth,
        }
    }

    return {
        entryType: node.entryType,
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        description: node.description,
        depth: node.depth,
        children: node.children.map(toEntryTreeDto),
    }
}
