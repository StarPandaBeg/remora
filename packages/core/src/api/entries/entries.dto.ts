import { z } from 'zod/v4'

import {
    entryArtifactFormat,
    entryStatus,
    type Entry,
    type EntryArtifact,
    type EntryMetadata,
} from '../../database/schema.ts'
import type { EntryTreeNode } from './entries.service.ts'

export interface EntryArtifactDto {
    id: number
    entryId: number
    type: EntryArtifact['type']
    format: EntryArtifact['format']
    name: string | null
    content: EntryArtifact['content']
    metadata: EntryArtifact['metadata']
}

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

export const entryArtifactDtoSchema: z.ZodType<EntryArtifactDto> = z.object({
    id: z.number().int().positive(),
    entryId: z.number().int().positive(),
    type: z.literal('transcription'),
    format: z.enum(entryArtifactFormat.enumValues),
    name: z.string().nullable(),
    content: z.string(),
    metadata: z.record(z.string(), z.json()),
})

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
z.globalRegistry.add(entryArtifactDtoSchema, { id: 'EntryArtifact' })
z.globalRegistry.add(entryTreeDtoSchema, { id: 'EntryTreeNode' })

type EntryWithOptionalArtifacts = Entry & { artifacts?: EntryArtifactDto[] }

function toEntryArtifactDto(artifact: EntryArtifactDto): EntryArtifactDto {
    return {
        id: artifact.id,
        entryId: artifact.entryId,
        type: artifact.type,
        format: artifact.format,
        name: artifact.name,
        content: artifact.content,
        metadata: artifact.metadata,
    }
}

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
