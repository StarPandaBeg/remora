import { eq, sql } from 'drizzle-orm'

import type { DbExecutor } from '../../database/index.ts'
import { configEntries } from '../../database/schema.ts'
import type { JsonValue } from '../../types/json.ts'

export function createRuntimeConfigRepository(db: DbExecutor) {
    const get = async (key: string) => {
        return await db.query.configEntries.findFirst({ where: { key } })
    }

    const getAll = async () => {
        return await db.query.configEntries.findMany()
    }

    const setMany = async (values: Record<string, JsonValue>) => {
        const entries = Object.entries(values)
        if (entries.length === 0) return []

        return await db
            .insert(configEntries)
            .values(entries.map(([key, value]) => ({ key, value })))
            .onConflictDoUpdate({
                target: configEntries.key,
                set: {
                    value: sql.raw(`excluded.${configEntries.value.name}`),
                    updatedAt: new Date(),
                },
            })
            .returning()
    }

    const set = async (key: string, value: JsonValue) => {
        const [entry] = await setMany({ [key]: value })
        return entry
    }

    const remove = async (key: string) => {
        const [entry] = await db
            .delete(configEntries)
            .where(eq(configEntries.key, key))
            .returning()
        return entry
    }

    return { get, getAll, set, setMany, delete: remove }
}
