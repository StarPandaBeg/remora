import { eq, sql } from 'drizzle-orm'
import type { AppDatabase } from '../../database/index.ts'
import { folders, type Folder } from '../../database/schema.ts'

export type FolderTreeRow = Folder & { depth: number }
export type CreateFolderInput = Pick<
    typeof folders.$inferInsert,
    'description' | 'name' | 'parentId'
>
export type UpdateFolderInput = Partial<
    Pick<typeof folders.$inferInsert, 'description' | 'name'>
>

export function createFolderRepository(db: AppDatabase) {
    const listAll = async () => {
        return await db.query.folders.findMany()
    }

    const findTree = async ({
        depth,
        rootId,
    }: {
        depth: number
        rootId?: number
    }) => {
        const result = await db.execute<FolderTreeRow>(sql`
            WITH RECURSIVE folder_tree AS (
                SELECT
                    ${folders.id} AS "id",
                    ${folders.parentId} AS "parentId",
                    ${folders.name} AS "name",
                    ${folders.description} AS "description",
                    ${folders.createdAt} AS "createdAt",
                    ${folders.updatedAt} AS "updatedAt",
                    0::integer AS "depth"
                FROM ${folders}
                WHERE ${
                    rootId === undefined
                        ? sql`${folders.parentId} IS NULL`
                        : sql`${folders.id} = ${rootId}`
                }

                UNION ALL

                SELECT
                    ${folders.id} AS "id",
                    ${folders.parentId} AS "parentId",
                    ${folders.name} AS "name",
                    ${folders.description} AS "description",
                    ${folders.createdAt} AS "createdAt",
                    ${folders.updatedAt} AS "updatedAt",
                    folder_tree."depth" + 1 AS "depth"
                FROM ${folders}
                INNER JOIN folder_tree
                    ON ${folders.parentId} = folder_tree."id"
                WHERE folder_tree."depth" < ${depth}
            )

            SELECT *
            FROM folder_tree
            ORDER BY "depth", "id"
        `)
        return result.rows
    }

    const findById = async (id: number) => {
        return await db.query.folders.findFirst({
            where: {
                id,
            },
        })
    }

    const create = async (values: CreateFolderInput) => {
        const [folder] = await db.insert(folders).values(values).returning()
        return folder
    }

    const update = async (id: number, values: UpdateFolderInput) => {
        const [folder] = await db
            .update(folders)
            .set({
                ...values,
                updatedAt: new Date(),
            })
            .where(eq(folders.id, id))
            .returning()

        return folder
    }

    const move = async (id: number, parentId: number | null) => {
        const [folder] = await db
            .update(folders)
            .set({
                parentId,
                updatedAt: new Date(),
            })
            .where(eq(folders.id, id))
            .returning()

        return folder
    }

    const contains = async (id: number, descendantId: number) => {
        const result = await db.execute<{ exists: boolean }>(sql`
            WITH RECURSIVE descendants AS (
                SELECT ${folders.id} AS "id"
                FROM ${folders}
                WHERE ${folders.parentId} = ${id}

                UNION ALL

                SELECT child.${sql.identifier(folders.id.name)} AS "id"
                FROM ${folders} AS child
                INNER JOIN descendants
                    ON child.${sql.identifier(folders.parentId.name)} = descendants."id"
            )

            SELECT EXISTS(
                SELECT 1
                FROM descendants
                WHERE "id" = ${descendantId}
            ) AS "exists"
        `)

        return result.rows[0]?.exists ?? false
    }

    const remove = async (id: number) => {
        const [folder] = await db
            .delete(folders)
            .where(eq(folders.id, id))
            .returning()

        return folder
    }

    return {
        contains,
        create,
        findById,
        findTree,
        listAll,
        move,
        remove,
        update,
    }
}
