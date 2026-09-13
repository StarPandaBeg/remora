import { drizzle } from 'drizzle-orm/node-postgres'
import { relations } from './schema.ts'

export function createDatabase(connectionString: string) {
    return drizzle(connectionString, { relations })
}

export type AppDatabase = ReturnType<typeof createDatabase>
export type AppTransaction = Parameters<
    Parameters<AppDatabase['transaction']>[0]
>[0]
export type DbExecutor = AppDatabase | AppTransaction
