import { sql } from 'drizzle-orm'
import type { AppDatabase } from '../../database/index.ts'
import { folders, type Folder } from '../../database/schema.ts'

export type FolderTreeRow = Folder & { depth: number }

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

    return { listAll, findTree }
}
