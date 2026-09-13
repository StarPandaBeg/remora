import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type {
    FastifyPluginCallback,
    FastifyReply,
    FastifyRequest,
} from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'
import { folderDtoSchema, toDto } from './folders.dto.ts'

export const getFoldersQuerySchema = z.object({
    depth: z.coerce
        .number()
        .int()
        .min(0)
        .max(10)
        .default(3)
        .describe('Maximum depth of the returned folder tree'),
})

const folderIdSchema = z.coerce.number().int().positive()

export const folderParamsSchema = z.object({
    id: folderIdSchema,
})

export const createFolderBodySchema = z.object({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().nullable().optional(),
    parentId: folderIdSchema.nullable().optional(),
})

export const updateFolderBodySchema = z
    .object({
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().nullable().optional(),
    })
    .refine(
        ({ description, name }) =>
            description !== undefined || name !== undefined,
        { message: 'At least one field must be provided' },
    )

export const moveFolderBodySchema = z.object({
    parentId: folderIdSchema.nullable(),
})

type GetFoldersQuery = z.output<typeof getFoldersQuerySchema>
type FolderParams = z.output<typeof folderParamsSchema>
type CreateFolderBody = z.output<typeof createFolderBodySchema>
type UpdateFolderBody = z.output<typeof updateFolderBodySchema>
type MoveFolderBody = z.output<typeof moveFolderBodySchema>

export async function getAllHandler(
    request: FastifyRequest<{ Querystring: GetFoldersQuery }>,
) {
    const tree = await request.server.services.folders.getTree({
        depth: request.query.depth,
    })

    return tree.map(toDto)
}

export async function createHandler(
    request: FastifyRequest<{ Body: CreateFolderBody }>,
    reply: FastifyReply,
) {
    const folder = await request.server.services.folders.create(request.body)

    return reply.code(201).send(toDto(folder))
}

export async function updateHandler(
    request: FastifyRequest<{
        Body: UpdateFolderBody
        Params: FolderParams
    }>,
) {
    const folder = await request.server.services.folders.update(
        request.params.id,
        request.body,
    )

    return toDto(folder)
}

export async function moveHandler(
    request: FastifyRequest<{
        Body: MoveFolderBody
        Params: FolderParams
    }>,
) {
    const folder = await request.server.services.folders.move(
        request.params.id,
        request.body.parentId,
    )

    return toDto(folder)
}

export async function deleteHandler(
    request: FastifyRequest<{ Params: FolderParams }>,
    reply: FastifyReply,
) {
    await request.server.services.folders.remove(request.params.id)

    return reply.code(204).send()
}

const foldersApi: FastifyPluginCallback = (fastify, _options, done) => {
    const api = fastify.withTypeProvider<ZodTypeProvider>()

    api.get(
        '/folders',
        {
            schema: {
                querystring: getFoldersQuerySchema,
                response: {
                    200: z.array(folderDtoSchema),
                },
                summary: 'Get the folder tree',
                tags: ['folders'],
            },
        },
        getAllHandler,
    )

    api.post(
        '/folders',
        {
            schema: {
                body: createFolderBodySchema,
                response: {
                    201: folderDtoSchema,
                },
                summary: 'Create a folder',
                tags: ['folders'],
            },
        },
        createHandler,
    )

    api.patch(
        '/folders/:id',
        {
            schema: {
                body: updateFolderBodySchema,
                params: folderParamsSchema,
                response: {
                    200: folderDtoSchema,
                },
                summary: 'Update a folder',
                tags: ['folders'],
            },
        },
        updateHandler,
    )

    api.patch(
        '/folders/:id/parent',
        {
            schema: {
                body: moveFolderBodySchema,
                params: folderParamsSchema,
                response: {
                    200: folderDtoSchema,
                },
                summary: 'Move a folder',
                tags: ['folders'],
            },
        },
        moveHandler,
    )

    api.delete(
        '/folders/:id',
        {
            schema: {
                params: folderParamsSchema,
                summary: 'Delete a folder',
                tags: ['folders'],
            },
        },
        deleteHandler,
    )

    done()
}

export default fastifyPlugin(foldersApi, {
    fastify: '5.x',
    name: 'folders-api',
})
