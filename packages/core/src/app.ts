import { drizzle } from 'drizzle-orm/node-postgres'
import type { FastifyPluginAsync } from 'fastify'

export interface AppOptions {
    serviceName?: string
}

export const options: AppOptions = {}

const app: FastifyPluginAsync<AppOptions> = (fastify, options) => {
    const serviceName = options.serviceName ?? '@remora/core'

    // Temporary add db here for schema build compilation
    // eslint-disable-next-line
    const db = drizzle(process.env.POSTGRES_URL!)

    fastify.get('/health', () => ({
        service: serviceName,
        status: 'ok',
    }))

    return Promise.resolve()
}

export default app
