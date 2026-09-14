import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import {
    jsonSchemaTransform,
    jsonSchemaTransformObject,
} from '@fastify/type-provider-zod'
import fastifyPlugin from 'fastify-plugin'

export default fastifyPlugin(
    async function swaggerPlugin(fastify) {
        await fastify.register(swagger, {
            openapi: {
                info: {
                    title: 'Remora Core API',
                    description:
                        'API for folders, entries and Remora services.',
                    version: '1.0.0',
                },
                components: {
                    securitySchemes: {
                        workerCallbackSecret: {
                            type: 'apiKey',
                            in: 'header',
                            name: 'x-worker-secret',
                        },
                    },
                },
                tags: [
                    {
                        name: 'entries',
                        description: 'Entry and combined tree management',
                    },
                    {
                        name: 'folders',
                        description: 'Folder tree management',
                    },
                    {
                        name: 'tasks',
                        description: 'Task management and worker callbacks',
                    },
                    {
                        name: 'system',
                        description: 'Service status',
                    },
                ],
            },
            transform: jsonSchemaTransform,
            transformObject: jsonSchemaTransformObject,
        })

        await fastify.register(swaggerUi, {
            routePrefix: '/docs',
            staticCSP: true,
            uiConfig: {
                deepLinking: true,
                docExpansion: 'list',
            },
        })
    },
    {
        fastify: '5.x',
        name: 'swagger',
    },
)
