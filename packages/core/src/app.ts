import multipart from '@fastify/multipart'
import {
    serializerCompiler,
    validatorCompiler,
} from '@fastify/type-provider-zod'
import type { FastifyPluginAsync } from 'fastify'

import { loadConfig, type AppConfig } from './config.ts'
import type { AppDatabase } from './database/index.ts'
import dependenciesPlugin from './plugins/dependencies.ts'
import swaggerPlugin from './plugins/swagger.ts'
import registerRoutes from './routes.ts'
import type { ObjectStorage } from './storage/object-storage.ts'

export interface AppOptions {
    config?: AppConfig
    database?: AppDatabase
    storage?: ObjectStorage
}

export const options: AppOptions = {}

const app: FastifyPluginAsync<AppOptions> = async (fastify, appOptions) => {
    const config = appOptions.config ?? loadConfig()

    fastify.setValidatorCompiler(validatorCompiler)
    fastify.setSerializerCompiler(serializerCompiler)

    await fastify.register(multipart, {
        limits: {
            fields: 10,
            files: 1,
            fileSize: config.maxFileSizeBytes,
            parts: 11,
        },
        throwFileSizeLimit: true,
    })
    await fastify.register(dependenciesPlugin, {
        config,
        database: appOptions.database,
        storage: appOptions.storage,
    })
    await fastify.register(swaggerPlugin)

    await fastify.register(registerRoutes)
}

export default app
