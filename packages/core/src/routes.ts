import type { FastifyPluginCallback } from 'fastify'
import fastifyPlugin from 'fastify-plugin'

import foldersApi from './api/folders/folders.route.ts'

const routes: FastifyPluginCallback = (fastify, _options, done) => {
    fastify.register(
        (api, _apiOptions, apiDone) => {
            api.register(foldersApi)
            apiDone()
        },
        { prefix: '/v1' },
    )

    fastify.get('/', () => 'Welcome to Remora API')
    fastify.get('/health', () => ({ status: 'ok' }))

    done()
}

export default fastifyPlugin(routes, {
    fastify: '5.x',
    name: 'routes',
})
