import { eq, sql } from 'drizzle-orm'

import type { DbExecutor } from '../../database/index.ts'
import {
    entries,
    folders,
    type Entry,
    type EntryArtifact,
    type EntryCreate,
    type EntryMetadata,
} from '../../database/schema.ts'

export type UpdateEntryInput = Partial<
    Pick<typeof entries.$inferInsert, 'content' | 'name'>
>

export type FolderTreeRow = {
    entryType: 'folder'
    id: number
    parentId: number | null
    name: string
    description: string | null
    content: null
    depth: number
}

export type EntryTreeRow = {
    entryType: 'entry'
    id: number
    parentId: number
    name: string
    type: Entry['type']
    description: null
    content: string | null
    metadata: EntryMetadata
    status: Entry['status']
    artifacts: Pick<
        EntryArtifact,
        'id' | 'entryId' | 'type' | 'format' | 'name' | 'content' | 'metadata'
    >[]
    depth: number
}

export type TreeRow = FolderTreeRow | EntryTreeRow

export function createEntryRepository(db: DbExecutor) {
    const create = async (values: EntryCreate) => {
        const [entry] = await db.insert(entries).values(values).returning()
        return entry
    }

    const findById = async (id: number) => {
        return await db.query.entries.findFirst({
            where: {
                id,
            },
            with: { artifacts: true },
        })
    }

    const folderExists = async (id: number) => {
        const folder = await db.query.folders.findFirst({
            columns: {
                id: true,
            },
            where: {
                id,
            },
        })

        return folder !== undefined
    }

    const update = async (id: number, values: UpdateEntryInput) => {
        const [updated] = await db
            .update(entries)
            .set({
                ...values,
                updatedAt: new Date(),
            })
            .where(eq(entries.id, id))
            .returning({ id: entries.id })

        return updated === undefined ? undefined : await findById(updated.id)
    }

    const updateMetadata = async (
        id: number,
        metadata: EntryMetadata,
    ): Promise<Entry | undefined> => {
        const [entry] = await db
            .update(entries)
            .set({ metadata, updatedAt: new Date() })
            .where(eq(entries.id, id))
            .returning()

        return entry
    }

    const updateStatus = async (id: number, status: Entry['status']) => {
        const [updated] = await db
            .update(entries)
            .set({ status, updatedAt: new Date() })
            .where(eq(entries.id, id))
            .returning({ id: entries.id })

        return updated === undefined ? undefined : await findById(updated.id)
    }

    const move = async (id: number, folderId: number) => {
        const [updated] = await db
            .update(entries)
            .set({
                folderId,
                updatedAt: new Date(),
            })
            .where(eq(entries.id, id))
            .returning({ id: entries.id })

        return updated === undefined ? undefined : await findById(updated.id)
    }

    const remove = async (id: number): Promise<Entry | undefined> => {
        const [entry] = await db
            .delete(entries)
            .where(eq(entries.id, id))
            .returning()

        return entry
    }

    const findTree = async ({
        depth,
        rootFolderId,
    }: {
        depth: number
        rootFolderId?: number
    }) => {
        const result = await db.execute<TreeRow>(sql`
            WITH RECURSIVE folder_tree AS (
                SELECT
                    ${folders.id} AS "id",
                    ${folders.parentId} AS "parentId",
                    ${folders.name} AS "name",
                    ${folders.description} AS "description",
                    NULL::"entryType" AS "type",
                    NULL::jsonb AS "metadata",
                    0::integer AS "depth"
                FROM ${folders}
                WHERE ${
                    rootFolderId === undefined
                        ? sql`${folders.parentId} IS NULL`
                        : sql`${folders.id} = ${rootFolderId}`
                }

                UNION ALL

                SELECT
                    ${folders.id} AS "id",
                    ${folders.parentId} AS "parentId",
                    ${folders.name} AS "name",
                    ${folders.description} AS "description",
                    NULL::"entryType" AS "type",
                    NULL::jsonb AS "metadata",
                    folder_tree."depth" + 1 AS "depth"
                FROM ${folders}
                INNER JOIN folder_tree
                    ON ${folders.parentId} = folder_tree."id"
                WHERE folder_tree."depth" < ${depth}
            ), tree_nodes AS (
                SELECT
                    'folder'::text AS "entryType",
                    folder_tree."id" AS "id",
                    folder_tree."parentId" AS "parentId",
                    folder_tree."name" AS "name",
                    folder_tree."description" AS "description",
                    NULL::text AS "content",
                    NULL::"entryType" AS "type",
                    NULL::jsonb AS "metadata",
                    NULL::"entryStatus" AS "status",
                    '[]'::jsonb AS "artifacts",
                    folder_tree."depth" AS "depth"
                FROM folder_tree

                UNION ALL

                SELECT
                    'entry'::text AS "entryType",
                    ${entries.id} AS "id",
                    ${entries.folderId} AS "parentId",
                    ${entries.name} AS "name",
                    NULL::text AS "description",
                    ${entries.content} AS "content",
                    ${entries.type} AS "type",
                    ${entries.metadata} AS "metadata",
                    ${entries.status} AS "status",
                    COALESCE(
                        (
                            SELECT jsonb_agg(
                                jsonb_build_object(
                                    'id', artifact.id,
                                    'entryId', artifact.entry_id,
                                    'type', artifact.type,
                                    'format', artifact.format,
                                    'name', artifact.name,
                                    'content', artifact.content,
                                    'metadata', artifact.metadata
                                )
                                ORDER BY artifact.id
                            )
                            FROM entry_artifacts AS artifact
                            WHERE artifact.entry_id = ${entries.id}
                        ),
                        '[]'::jsonb
                    ) AS "artifacts",
                    folder_tree."depth" + 1 AS "depth"
                FROM ${entries}
                INNER JOIN folder_tree
                    ON ${entries.folderId} = folder_tree."id"
                WHERE folder_tree."depth" < ${depth}
            )

            SELECT *
            FROM tree_nodes
            ORDER BY "depth", "entryType", "id"
        `)

        return result.rows
    }

    return {
        create,
        findById,
        findTree,
        folderExists,
        move,
        remove,
        update,
        updateMetadata,
        updateStatus,
    }
}
