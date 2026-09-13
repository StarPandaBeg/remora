import type { AppConfig } from '../config.ts'
import type { AppDatabase } from '../database/index.ts'
import type { RepositoryRegistry } from '../repositories.ts'
import type { ServiceRegistry } from '../services.ts'
import type { ObjectStorage } from '../storage/object-storage.ts'

declare module 'fastify' {
    interface FastifyInstance {
        config: AppConfig
        db: AppDatabase
        repositories: RepositoryRegistry
        services: ServiceRegistry
        storage: ObjectStorage
    }
}
