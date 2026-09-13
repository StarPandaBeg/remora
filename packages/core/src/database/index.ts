import { drizzle } from 'drizzle-orm/node-postgres'
import { relations } from './schema.ts'

export type AppDatabase = typeof database

export const database = drizzle(process.env.POSTGRES_URL!, { relations })
