import type { AppDatabase } from '../database/index.ts'

declare module 'fastify' {
    interface FastifyInstance {
        db: AppDatabase
    }
}
