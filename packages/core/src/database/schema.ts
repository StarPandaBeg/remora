import { defineRelations } from 'drizzle-orm'
import * as t from 'drizzle-orm/pg-core'

/** Mixin for `created_at` and `updated_at` columns */
const timestamps = {
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp().defaultNow().notNull(),
}
export const entryType = t.pgEnum('entryType', ['note', 'video_record'])
export const processingStatus = t.pgEnum('processingStatus', [
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled',
])
export const processingStepStatus = t.pgEnum('processingStepStatus', [
    'blocked',
    'queued',
    'running',
    'completed',
    'failed',
])
export type ProcessingStatus = (typeof processingStatus.enumValues)[number]
export type ProcessingStepStatus =
    (typeof processingStepStatus.enumValues)[number]

export interface StoredObjectMetadata {
    bucket: string
    objectKey: string
    mimeType: string
    originalName: string
    size: number
}

export type EntryMetadata = Record<string, unknown> & {
    originalVideo?: StoredObjectMetadata
}

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
        metadata: t.jsonb().$type<EntryMetadata>().notNull().default({}),
        ...timestamps,
    },
    (table) => [t.index('entries_folder_id_idx').on(table.folderId)],
)
export type Entry = typeof entries.$inferSelect
export type EntryCreate = typeof entries.$inferInsert

export const taskRuns = t.snakeCase.table('task_runs', {
    id: t.serial().primaryKey(),
    entryId: t
        .integer()
        .notNull()
        .references(() => entries.id, {
            onDelete: 'cascade',
        }),
    status: processingStatus().notNull().default('pending'),
    config: t.jsonb().default({}),
    type: t.varchar().notNull(),
    pipelineVersion: t.integer().notNull().default(1),
    ...timestamps,
    startedAt: t.timestamp(),
    finishedAt: t.timestamp(),
})
export type TaskRun = typeof taskRuns.$inferSelect
export type TaskRunCreate = typeof taskRuns.$inferInsert

export const taskSteps = t.snakeCase.table('task_steps', {
    id: t.serial().primaryKey(),
    runId: t
        .integer()
        .notNull()
        .references(() => taskRuns.id, {
            onDelete: 'cascade',
        }),
    type: t.varchar().notNull(),
    status: processingStepStatus().notNull().default('blocked'),
    input: t.jsonb().default({}),
    output: t.jsonb().default({}),
    error: t.jsonb().default({}),
    context: t.jsonb().default({}),
    position: t.integer().notNull(),
    ...timestamps,
    startedAt: t.timestamp(),
    finishedAt: t.timestamp(),
})
export type TaskStep = typeof taskSteps.$inferSelect
export type TaskStepCreate = typeof taskSteps.$inferInsert

export const relations = defineRelations(
    { folders, entries, taskRuns, taskSteps },
    (r) => ({
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
            tasks: r.many.taskRuns(),
        },
        taskRuns: {
            entry: r.one.entries({
                from: r.taskRuns.entryId,
                to: r.entries.id,
            }),
            steps: r.many.taskSteps(),
        },
        taskSteps: {
            task: r.one.taskRuns({
                from: r.taskSteps.runId,
                to: r.taskRuns.id,
            }),
        },
    }),
)
