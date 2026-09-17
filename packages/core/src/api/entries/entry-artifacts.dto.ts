import { z } from 'zod/v4'

import {
    entryArtifactFormat,
    type EntryArtifact,
} from '../../database/schema.ts'

export interface EntryArtifactDto {
    id: number
    entryId: number
    type: EntryArtifact['type']
    format: EntryArtifact['format']
    name: string | null
    content: EntryArtifact['content']
    metadata: EntryArtifact['metadata']
}

export const entryArtifactDtoSchema: z.ZodType<EntryArtifactDto> = z.object({
    id: z.number().int().positive(),
    entryId: z.number().int().positive(),
    type: z.literal('transcription'),
    format: z.enum(entryArtifactFormat.enumValues),
    name: z.string().nullable(),
    content: z.string(),
    metadata: z.record(z.string(), z.json()),
})

z.globalRegistry.add(entryArtifactDtoSchema, { id: 'EntryArtifact' })

export function toEntryArtifactDto(
    artifact: EntryArtifactDto,
): EntryArtifactDto {
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
