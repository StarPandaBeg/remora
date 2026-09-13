import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'

import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type {
    FastifyPluginCallback,
    FastifyReply,
    FastifyRequest,
} from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'

import { validateVideoFile } from '../../storage/video.ts'
import { HttpError } from '../../util/error.ts'
import {
    entryDtoSchema,
    entryTreeDtoSchema,
    toEntryDto,
    toEntryTreeDto,
} from './entries.dto.ts'

const positiveIdSchema = z.coerce.number().int().positive()

export const entryParamsSchema = z.object({
    id: positiveIdSchema,
})

export const noteEntryBodySchema = z.strictObject({
    type: z.literal('note'),
    folderId: positiveIdSchema,
    name: z.string().trim().min(1).max(255),
    content: z.string(),
})

export const videoEntryFieldsSchema = z.strictObject({
    type: z.literal('video_record'),
    folderId: positiveIdSchema,
    name: z.string().trim().min(1).max(255),
})

export const videoEntryBodySchema = videoEntryFieldsSchema.extend({
    video: z.unknown(),
})

export const createEntryBodySchema = z.discriminatedUnion('type', [
    noteEntryBodySchema,
    videoEntryBodySchema,
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
type UpdateEntryBody = z.output<typeof updateEntryBodySchema>
type MoveEntryBody = z.output<typeof moveEntryBodySchema>
type EntryTreeQuery = z.output<typeof entryTreeQuerySchema>

function readMultipartField(
    values: Record<string, unknown>,
    fieldName: string,
): unknown {
    const field = values[fieldName]
    if (
        field === null ||
        typeof field !== 'object' ||
        Array.isArray(field) ||
        !('value' in field)
    ) {
        return undefined
    }
    return field.value
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input)
    if (!result.success) {
        throw new HttpError(
            'ENTRY_INPUT_INVALID',
            z.prettifyError(result.error),
            400,
        )
    }
    return result.data
}

async function readFileHeader(path: string) {
    const buffer = Buffer.alloc(12)
    const file = await open(path, 'r')
    try {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        return buffer.subarray(0, bytesRead)
    } finally {
        await file.close()
    }
}

export async function createHandler(
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
) {
    if (!request.isMultipart()) {
        const input = parseInput(noteEntryBodySchema, request.body)
        const entry = await request.server.services.entries.create(input)
        return reply.code(201).send(toEntryDto(entry))
    }

    const { files, values } = await request.saveRequestFiles()
    const uploadedFile = files[0]
    if (
        files.length !== 1 ||
        uploadedFile === undefined ||
        uploadedFile.fieldname !== 'video'
    ) {
        throw new HttpError(
            'VIDEO_FILE_REQUIRED',
            'Exactly one file must be provided in the video field',
            400,
        )
    }

    const fields = parseInput(videoEntryFieldsSchema, {
        type: readMultipartField(values, 'type'),
        folderId: readMultipartField(values, 'folderId'),
        name: readMultipartField(values, 'name'),
    })
    const fileInfo = await stat(uploadedFile.filepath)
    const originalName = basename(uploadedFile.filename)
    const extension = validateVideoFile(
        {
            filename: originalName,
            mimeType: uploadedFile.mimetype,
            size: fileInfo.size,
            header: await readFileHeader(uploadedFile.filepath),
        },
        request.server.config.maxVideoSizeBytes,
    )
    const entry = await request.server.services.entries.create({
        ...fields,
        video: {
            body: createReadStream(uploadedFile.filepath),
            extension,
            mimeType: uploadedFile.mimetype,
            originalName,
            size: fileInfo.size,
        },
    })

    return reply.code(201).send(toEntryDto(entry))
}

export async function updateHandler(
    request: FastifyRequest<{
        Body: UpdateEntryBody
        Params: EntryParams
    }>,
) {
    const entry = await request.server.services.entries.update(
        request.params.id,
        request.body,
    )

    return toEntryDto(entry)
}

export async function moveHandler(
    request: FastifyRequest<{
        Body: MoveEntryBody
        Params: EntryParams
    }>,
) {
    const entry = await request.server.services.entries.move(
        request.params.id,
        request.body.folderId,
    )

    return toEntryDto(entry)
}

export async function deleteHandler(
    request: FastifyRequest<{ Params: EntryParams }>,
    reply: FastifyReply,
) {
    await request.server.services.entries.remove(request.params.id)

    return reply.code(204).send()
}

export async function getTreeHandler(
    request: FastifyRequest<{ Querystring: EntryTreeQuery }>,
) {
    const tree = await request.server.services.entries.getTree(request.query)

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
                consumes: ['application/json', 'multipart/form-data'],
                description:
                    'Create a note from JSON or a video_record from multipart fields type, folderId, name and video.',
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
