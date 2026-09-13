import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyPluginCallback, FastifyRequest } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'
import { toDto } from './folders.dto.ts'
import { createFolderRepository } from './folders.model.ts'
import { createFolderService } from './folders.service.ts'

export const getFoldersQuerySchema = z.object({
    depth: z.coerce.number().int().min(0).max(10).default(3),
})

type GetFoldersQuery = z.output<typeof getFoldersQuerySchema>

export async function getAllHandler(
    request: FastifyRequest<{ Querystring: GetFoldersQuery }>,
) {
    const folderRepository = createFolderRepository(request.server.db)
    const foldersService = createFolderService(folderRepository)
    const tree = await foldersService.getTree({ depth: request.query.depth })

    return tree.map(toDto)
}

const foldersApi: FastifyPluginCallback = (fastify, _options, done) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        '/folders',
        {
            schema: {
                querystring: getFoldersQuerySchema,
            },
        },
        getAllHandler,
    )

    done()
}

export default fastifyPlugin(foldersApi, {
    fastify: '5.x',
    name: 'folders-api',
})
