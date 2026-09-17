import { and, eq } from 'drizzle-orm'

import type { DbExecutor } from '../../database/index.ts'
import {
    entryArtifacts,
    type EntryArtifact,
    type EntryArtifactCreate,
} from '../../database/schema.ts'

export type CreateEntryArtifactInput = Pick<
    EntryArtifactCreate,
    'content' | 'entryId' | 'format' | 'type'
> &
    Partial<Pick<EntryArtifactCreate, 'metadata' | 'name'>>

export type UpdateEntryArtifactContentInput = Pick<
    EntryArtifact,
    'content' | 'metadata'
>

export type UpdateTextEntryArtifactInput = Partial<
    Pick<EntryArtifact, 'content' | 'name'>
>

export function createEntryArtifactRepository(db: DbExecutor) {
    const create = async (values: CreateEntryArtifactInput) => {
        const [artifact] = await db
            .insert(entryArtifacts)
            .values(values)
            .returning()

        return artifact
    }

    const findById = async (id: number) => {
        return await db.query.entryArtifacts.findFirst({ where: { id } })
    }

    const findByEntryId = async (entryId: number) => {
        return await db.query.entryArtifacts.findMany({
            where: { entryId },
            orderBy: { id: 'asc' },
        })
    }

    const updateContentAndMetadata = async (
        id: number,
        values: UpdateEntryArtifactContentInput,
    ) => {
        const [artifact] = await db
            .update(entryArtifacts)
            .set({
                content: values.content,
                metadata: values.metadata,
                updatedAt: new Date(),
            })
            .where(eq(entryArtifacts.id, id))
            .returning()

        return artifact
    }

    const updateText = async (
        id: number,
        values: UpdateTextEntryArtifactInput,
    ) => {
        const [artifact] = await db
            .update(entryArtifacts)
            .set({ ...values, updatedAt: new Date() })
            .where(
                and(
                    eq(entryArtifacts.id, id),
                    eq(entryArtifacts.format, 'text'),
                ),
            )
            .returning()

        return artifact
    }

    return {
        create,
        findByEntryId,
        findById,
        updateContentAndMetadata,
        updateText,
    }
}

export type EntryArtifactRepository = ReturnType<
    typeof createEntryArtifactRepository
>
