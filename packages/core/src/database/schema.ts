import { defineRelations } from 'drizzle-orm'
import * as t from 'drizzle-orm/pg-core'

/** Mixin for `created_at` and `updated_at` columns */
const timestamps = {
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp().defaultNow().notNull(),
}
export const entryType = t.pgEnum('entryType', ['note'])

export const folders = t.snakeCase.table(
    'folders',
    {
        id: t.serial().primaryKey(),
        parentId: t.integer().references((): t.AnyPgColumn => folders.id, {
            onDelete: 'cascade',
        }),
        name: t.varchar().notNull(),
        description: t.text(),
        ...timestamps,
    },
    (table) => [t.index('folders_parent_id_idx').on(table.parentId)],
)
export type Folder = typeof folders.$inferSelect

export const entries = t.snakeCase.table(
    'entries',
    {
        id: t.serial().primaryKey(),
        folderId: t
            .integer()
            .notNull()
            .references(() => folders.id, {
                onDelete: 'cascade',
            }),
        name: t.varchar().notNull(),
        type: entryType().notNull(),
        content: t.text(),
        metadata: t.jsonb().default('{}'),
        ...timestamps,
    },
    (table) => [t.index('entries_folder_id_idx').on(table.folderId)],
)
export type Entry = typeof entries.$inferSelect

export const relations = defineRelations({ folders, entries }, (r) => ({
    folders: {
        parent: r.one.folders({
            from: r.folders.parentId,
            to: r.folders.id,
        }),
        children: r.many.folders(),
        entries: r.many.entries(),
    },
    entries: {
        folder: r.one.folders({
            from: r.entries.folderId,
            to: r.folders.id,
        }),
    },
}))
