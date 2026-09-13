import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type {
    FastifyPluginCallback,
    FastifyReply,
    FastifyRequest,
} from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'

import {
    entryDtoSchema,
    entryTreeDtoSchema,
    toEntryDto,
    toEntryTreeDto,
} from './entries.dto.ts'
import { createEntryRepository } from './entries.model.ts'
import { createEntryService } from './entries.service.ts'

const positiveIdSchema = z.coerce.number().int().positive()

export const entryParamsSchema = z.object({
    id: positiveIdSchema,
})

export const noteEntryBodySchema = z.strictObject({
    type: z.literal('note'),
    folderId: positiveIdSchema,
    name: z.string(),
    content: z.string(),
})

export const createEntryBodySchema = z.discriminatedUnion('type', [
    noteEntryBodySchema,
])

export const updateEntryBodySchema = z
    .object({
        name: z.string().trim().min(1).max(255).optional(),
        content: z.string().nullable().optional(),
    })
    .refine(
        ({ content, name }) => content !== undefined || name !== undefined,
        { message: 'At least one field must be provided' },
    )

export const moveEntryBodySchema = z.object({
    folderId: positiveIdSchema,
})

export const entryTreeQuerySchema = z.object({
    depth: z.coerce
        .number()
        .int()
        .min(0)
        .max(10)
        .default(3)
        .describe('Maximum depth of folders and entries in the tree'),
    rootFolderId: positiveIdSchema
        .optional()
        .describe('Folder from which to build the tree'),
})

type EntryParams = z.output<typeof entryParamsSchema>
type CreateEntryBody = z.output<typeof createEntryBodySchema>
type UpdateEntryBody = z.output<typeof updateEntryBodySchema>
type MoveEntryBody = z.output<typeof moveEntryBodySchema>
type EntryTreeQuery = z.output<typeof entryTreeQuerySchema>

export async function createHandler(
    request: FastifyRequest<{ Body: CreateEntryBody }>,
    reply: FastifyReply,
) {
    const repository = createEntryRepository(request.server.db)
    const service = createEntryService(repository)
    const entry = await service.create(request.body)

    return reply.code(201).send(toEntryDto(entry))
}

export async function updateHandler(
    request: FastifyRequest<{
        Body: UpdateEntryBody
        Params: EntryParams
    }>,
) {
    const repository = createEntryRepository(request.server.db)
    const service = createEntryService(repository)
    const entry = await service.update(request.params.id, request.body)

    return toEntryDto(entry)
}

export async function moveHandler(
    request: FastifyRequest<{
        Body: MoveEntryBody
        Params: EntryParams
    }>,
) {
    const repository = createEntryRepository(request.server.db)
    const service = createEntryService(repository)
    const entry = await service.move(request.params.id, request.body.folderId)

    return toEntryDto(entry)
}

export async function deleteHandler(
    request: FastifyRequest<{ Params: EntryParams }>,
    reply: FastifyReply,
) {
    const repository = createEntryRepository(request.server.db)
    const service = createEntryService(repository)
    await service.remove(request.params.id)

    return reply.code(204).send()
}

export async function getTreeHandler(
    request: FastifyRequest<{ Querystring: EntryTreeQuery }>,
) {
    const repository = createEntryRepository(request.server.db)
    const service = createEntryService(repository)
    const tree = await service.getTree(request.query)

    return tree.map(toEntryTreeDto)
}

const entriesApi: FastifyPluginCallback = (fastify, _options, done) => {
    const api = fastify.withTypeProvider<ZodTypeProvider>()

    api.get(
        '/entries/tree',
        {
            schema: {
                querystring: entryTreeQuerySchema,
                response: {
                    200: z.array(entryTreeDtoSchema),
                },
                summary: 'Get the combined folder and entry tree',
                tags: ['entries'],
            },
        },
        getTreeHandler,
    )

    api.post(
        '/entries',
        {
            schema: {
                body: createEntryBodySchema,
                response: {
                    201: entryDtoSchema,
                },
                summary: 'Create an entry',
                tags: ['entries'],
            },
        },
        createHandler,
    )

    api.patch(
        '/entries/:id',
        {
            schema: {
                body: updateEntryBodySchema,
                params: entryParamsSchema,
                response: {
                    200: entryDtoSchema,
                },
                summary: 'Update an entry',
                tags: ['entries'],
            },
        },
        updateHandler,
    )

    api.patch(
        '/entries/:id/folder',
        {
            schema: {
                body: moveEntryBodySchema,
                params: entryParamsSchema,
                response: {
                    200: entryDtoSchema,
                },
                summary: 'Move an entry to another folder',
                tags: ['entries'],
            },
        },
        moveHandler,
    )

    api.delete(
        '/entries/:id',
        {
            schema: {
                params: entryParamsSchema,
                summary: 'Delete an entry',
                tags: ['entries'],
            },
        },
        deleteHandler,
    )

    done()
}

export default fastifyPlugin(entriesApi, {
    fastify: '5.x',
    name: 'entries-api',
})
