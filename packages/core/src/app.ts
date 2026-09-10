import type { FastifyPluginAsync } from 'fastify'

export interface AppOptions {
    serviceName?: string
}

export const options: AppOptions = {}

const app: FastifyPluginAsync<AppOptions> = (fastify, options) => {
    const serviceName = options.serviceName ?? '@remora/core'

    fastify.get('/health', () => ({
        service: serviceName,
        status: 'ok',
    }))

    return Promise.resolve()
}

export default app
