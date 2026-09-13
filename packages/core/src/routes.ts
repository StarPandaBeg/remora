import type { FastifyPluginCallback } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'

import entriesApi from './api/entries/entries.route.ts'
import foldersApi from './api/folders/folders.route.ts'
import tasksApi from './api/tasks/tasks.route.ts'

const routes: FastifyPluginCallback = (fastify, _options, done) => {
    fastify.register(
        (api, _apiOptions, apiDone) => {
            api.register(entriesApi)
            api.register(foldersApi)
            api.register(tasksApi)
            apiDone()
        },
        { prefix: '/v1' },
    )

    fastify.get(
        '/',
        {
            schema: {
                response: {
                    200: z.string(),
                },
                summary: 'API welcome message',
                tags: ['system'],
            },
        },
        () => 'Welcome to Remora API',
    )
    fastify.get(
        '/health',
        {
            schema: {
                response: {
                    200: z.object({ status: z.literal('ok') }),
                },
                summary: 'Check service health',
                tags: ['system'],
            },
        },
        () => ({ status: 'ok' }),
    )

    done()
}

export default fastifyPlugin(routes, {
    fastify: '5.x',
    name: 'routes',
})
