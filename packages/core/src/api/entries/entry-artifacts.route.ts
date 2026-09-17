import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyPluginCallback, FastifyRequest } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'

import {
    entryArtifactDtoSchema,
    toEntryArtifactDto,
} from './entry-artifacts.dto.ts'

const artifactIdSchema = z.coerce.number().int().positive()

export const entryArtifactParamsSchema = z.object({
    id: artifactIdSchema,
})

export const updateTextEntryArtifactBodySchema = z
    .strictObject({
        name: z.string().trim().min(1).max(255).nullable().optional(),
        content: z.string().optional(),
    })
    .refine(
        ({ content, name }) => content !== undefined || name !== undefined,
        { message: 'At least one field must be provided' },
    )

type EntryArtifactParams = z.output<typeof entryArtifactParamsSchema>
type UpdateTextEntryArtifactBody = z.output<
    typeof updateTextEntryArtifactBodySchema
>

export async function getEntryArtifactHandler(
    request: FastifyRequest<{ Params: EntryArtifactParams }>,
) {
    const artifact = await request.server.services.entryArtifacts.getById(
        request.params.id,
    )

    return toEntryArtifactDto(artifact)
}

export async function updateTextEntryArtifactHandler(
    request: FastifyRequest<{
        Body: UpdateTextEntryArtifactBody
        Params: EntryArtifactParams
    }>,
) {
    const artifact = await request.server.services.entryArtifacts.updateText(
        request.params.id,
        request.body,
    )

    return toEntryArtifactDto(artifact)
}

const entryArtifactsApi: FastifyPluginCallback = (fastify, _options, done) => {
    const api = fastify.withTypeProvider<ZodTypeProvider>()

    api.get(
        '/entry-artifacts/:id',
        {
            schema: {
                params: entryArtifactParamsSchema,
                response: { 200: entryArtifactDtoSchema },
                summary: 'Get an entry artifact',
                tags: ['entry-artifacts'],
            },
        },
        getEntryArtifactHandler,
    )

    api.patch(
        '/entry-artifacts/:id',
        {
            schema: {
                body: updateTextEntryArtifactBodySchema,
                params: entryArtifactParamsSchema,
                response: { 200: entryArtifactDtoSchema },
                summary: 'Update a text entry artifact',
                tags: ['entry-artifacts'],
            },
        },
        updateTextEntryArtifactHandler,
    )

    done()
}

export default fastifyPlugin(entryArtifactsApi, {
    fastify: '5.x',
    name: 'entry-artifacts-api',
})
