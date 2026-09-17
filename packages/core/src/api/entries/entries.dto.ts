import { z } from 'zod/v4'

import {
    entryStatus,
    type Entry,
    type EntryMetadata,
} from '../../database/schema.ts'
import type { EntryTreeNode } from './entries.service.ts'
import {
    entryArtifactDtoSchema,
    toEntryArtifactDto,
    type EntryArtifactDto,
} from './entry-artifacts.dto.ts'

export { entryArtifactDtoSchema, type EntryArtifactDto }

export interface EntryDto {
    id: number
    folderId: number
    name: string
    type: Entry['type']
    content: string | null
    metadata: EntryMetadata
    status: Entry['status']
    artifacts: EntryArtifactDto[]
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
          status: Entry['status']
          artifacts: EntryArtifactDto[]
          depth: number
      }

const storedFileMetadataSchema = z.object({
    bucket: z.string(),
    objectKey: z.string(),
    mimeType: z.string(),
    originalName: z.string(),
    size: z.number().int().nonnegative(),
    recordId: z.string(),
    url: z.url(),
    disposition: z.enum(['inline', 'attachment']),
})

export const entryMetadataSchema: z.ZodType<EntryMetadata> = z
    .object({
        relatedTasks: z.array(z.number().int().positive()),
        file: storedFileMetadataSchema.optional(),
    })
    .catchall(z.unknown())

export const entryDtoSchema: z.ZodType<EntryDto> = z.object({
    id: z.number().int().positive(),
    folderId: z.number().int().positive(),
    name: z.string(),
    type: z.enum(['note', 'video_record', 'file']),
    content: z.string().nullable(),
    metadata: entryMetadataSchema,
    status: z.enum(entryStatus.enumValues),
    artifacts: z.array(entryArtifactDtoSchema),
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
            metadata: entryMetadataSchema,
            status: z.enum(entryStatus.enumValues),
            artifacts: z.array(entryArtifactDtoSchema),
            depth: z.number().int().min(0),
        }),
    ]),
)

z.globalRegistry.add(entryDtoSchema, { id: 'Entry' })
z.globalRegistry.add(entryTreeDtoSchema, { id: 'EntryTreeNode' })

type EntryWithOptionalArtifacts = Entry & { artifacts?: EntryArtifactDto[] }

export function toEntryDto(entry: EntryWithOptionalArtifacts): EntryDto {
    return {
        id: entry.id,
        folderId: entry.folderId,
        name: entry.name,
        type: entry.type,
        content: entry.content,
        metadata: entry.metadata,
        status: entry.status,
        artifacts: (entry.artifacts ?? []).map(toEntryArtifactDto),
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
            status: node.status,
            artifacts: node.artifacts.map(toEntryArtifactDto),
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
