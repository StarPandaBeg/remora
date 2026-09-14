import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type {
    FastifyPluginCallback,
    FastifyReply,
    FastifyRequest,
} from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'

import type { JsonValue } from '../../types/json.ts'

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
        z.string(),
        z.number().finite(),
        z.boolean(),
        z.null(),
        z.array(jsonValueSchema),
        z.record(z.string(), jsonValueSchema),
    ]),
)

export const runtimeConfigSchema = z.record(z.string(), jsonValueSchema)

export const runtimeConfigPatchSchema = runtimeConfigSchema.refine(
    (input) => Object.keys(input).length > 0,
    { message: 'At least one config value must be provided' },
)

export const runtimeConfigParamsSchema = z.object({
    key: z.string().min(1),
})

type RuntimeConfigPatch = z.output<typeof runtimeConfigPatchSchema>
type RuntimeConfigParams = z.output<typeof runtimeConfigParamsSchema>

export async function getConfigHandler(request: FastifyRequest) {
    return await request.server.services.config.getEffective()
}

export async function patchConfigHandler(
    request: FastifyRequest<{ Body: RuntimeConfigPatch }>,
) {
    return await request.server.services.config.update(request.body)
}

export async function resetConfigHandler(
    request: FastifyRequest<{ Params: RuntimeConfigParams }>,
    reply: FastifyReply,
) {
    await request.server.services.config.reset(request.params.key)
    return reply.code(204).send()
}

const configApi: FastifyPluginCallback = (fastify, _options, done) => {
    const api = fastify.withTypeProvider<ZodTypeProvider>()

    api.get(
        '/config',
        {
            schema: {
                response: { 200: runtimeConfigSchema },
                summary: 'Get effective runtime configuration',
                tags: ['config'],
            },
        },
        getConfigHandler,
    )

    api.patch(
        '/config',
        {
            schema: {
                body: runtimeConfigPatchSchema,
                response: { 200: runtimeConfigSchema },
                summary: 'Partially update runtime configuration',
                tags: ['config'],
            },
        },
        patchConfigHandler,
    )

    api.delete(
        '/config/:key',
        {
            schema: {
                params: runtimeConfigParamsSchema,
                summary: 'Reset a runtime configuration value to its default',
                tags: ['config'],
            },
        },
        resetConfigHandler,
    )

    done()
}

export default fastifyPlugin(configApi, {
    fastify: '5.x',
    name: 'config-api',
})
