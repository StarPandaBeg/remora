import type { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'

import type { AppConfig } from '../config.ts'
import { createDatabase, type AppDatabase } from '../database/index.ts'
import { createRepositories, createTransactionRunner } from '../repositories.ts'
import { createServices } from '../services.ts'
import { createMinioStorage } from '../storage/minio-storage.ts'
import type { ObjectStorage } from '../storage/object-storage.ts'

export interface DependencyOptions {
    config: AppConfig
    database?: AppDatabase
    storage?: ObjectStorage
}

const dependenciesPlugin: FastifyPluginAsync<DependencyOptions> = async (
    fastify,
    options,
) => {
    const ownsDatabase = options.database === undefined
    const db = options.database ?? createDatabase(options.config.postgresUrl)
    const storage = options.storage ?? createMinioStorage(options.config.minio)

    await storage.ensureBucket()

    const repositories = createRepositories(db)
    const services = createServices({
        repositories,
        storage,
        transaction: createTransactionRunner(db, repositories),
    })

    fastify.decorate('config', options.config)
    fastify.decorate('db', db)
    fastify.decorate('repositories', repositories)
    fastify.decorate('services', services)
    fastify.decorate('storage', storage)

    if (ownsDatabase) {
        fastify.addHook('onClose', async () => {
            await db.$client.end()
        })
    }
}

export default fastifyPlugin(dependenciesPlugin, {
    fastify: '5.x',
    name: 'dependencies',
})
