import {
    serializerCompiler,
    validatorCompiler,
} from '@fastify/type-provider-zod'
import type { FastifyPluginAsync } from 'fastify'

import dbPlugin from './plugins/db.ts'
import swaggerPlugin from './plugins/swagger.ts'
import registerRoutes from './routes.ts'

export interface AppOptions {
    serviceName?: string
}

export const options: AppOptions = {}

const app: FastifyPluginAsync<AppOptions> = (fastify) => {
    fastify.setValidatorCompiler(validatorCompiler)
    fastify.setSerializerCompiler(serializerCompiler)

    fastify.register(dbPlugin)
    fastify.register(swaggerPlugin)

    fastify.register(registerRoutes)
    return Promise.resolve()
}

export default app
