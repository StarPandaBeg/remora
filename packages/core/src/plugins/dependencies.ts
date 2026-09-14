import type { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'

import { createRuntimeConfigService } from '../api/config/config.ts'
import type { AppConfig } from '../config.ts'
import { createDatabase, type AppDatabase } from '../database/index.ts'
import { createOrchestrator } from '../orchestrator/orchestrator.ts'
import { createWorker } from '../orchestrator/worker.ts'
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
    const transaction = createTransactionRunner(db, repositories)
    const runtimeConfig = createRuntimeConfigService(repositories, transaction)
    const worker = createWorker({
        publicBaseUrl: options.config.publicBaseUrl,
        workerUrl: options.config.workerUrl,
        requestTimeoutMs: options.config.workerRequestTimeoutMs,
    })
    const orchestrator = createOrchestrator(
        repositories,
        transaction,
        worker,
        runtimeConfig,
    )
    const services = createServices({
        publicBaseUrl: options.config.publicBaseUrl,
        repositories,
        storage,
        transaction,
        orchestrator,
        runtimeConfig,
    })

    fastify.decorate('config', options.config)
    fastify.decorate('db', db)
    fastify.decorate('repositories', repositories)
    fastify.decorate('orchestrator', orchestrator)
    fastify.decorate('worker', worker)
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
