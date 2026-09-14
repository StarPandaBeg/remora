import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type {
    FastifyPluginCallback,
    FastifyReply,
    FastifyRequest,
} from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'

import { entryType } from '../../database/schema.ts'
import { sendFile } from '../../http/file-response.ts'
import { readMultipartForm } from '../../http/multipart.ts'
import { parseHttpInput } from '../../http/validation.ts'
import {
    fileEntryRegistry,
    isFileEntryType,
    validateEntryFile,
    type FileEntryType,
} from '../../storage/entry-file-validation.ts'
import { HttpError } from '../../util/error.ts'
import {
    entryDtoSchema,
    entryTreeDtoSchema,
    toEntryDto,
    toEntryTreeDto,
} from './entries.dto.ts'

const positiveIdSchema = z.coerce.number().int().positive()
const entryTypeSchema = z.enum(entryType.enumValues)

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

export const fileEntryFieldsSchema = z.strictObject({
    type: z.literal('file'),
    folderId: positiveIdSchema,
    name: z.string().trim().min(1).max(255),
})

const fileEntryTypeSchema = z.enum(
    Object.keys(fileEntryRegistry) as [FileEntryType, ...FileEntryType[]],
)
const fileBackedEntryFieldsSchema = z.strictObject({
    type: fileEntryTypeSchema,
    folderId: positiveIdSchema,
    name: z.string().trim().min(1).max(255),
})

export const videoEntryBodySchema = videoEntryFieldsSchema.extend({
    file: z.unknown(),
})
export const fileEntryBodySchema = fileEntryFieldsSchema.extend({
    file: z.unknown(),
})

export const createEntryBodySchema = z.discriminatedUnion('type', [
    noteEntryBodySchema,
    videoEntryBodySchema,
    fileEntryBodySchema,
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

export async function createHandler(
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
) {
    if (!request.isMultipart()) {
        const input = parseHttpInput(
            noteEntryBodySchema,
            request.body,
            'ENTRY_INPUT_INVALID',
        )
        const entry = await request.server.services.entries.create(input)
        return reply.code(201).send(toEntryDto(entry))
    }

    const { fields: rawFields, files } = await readMultipartForm(request)
    const entryType = parseHttpInput(
        entryTypeSchema,
        rawFields.type,
        'ENTRY_INPUT_INVALID',
    )

    if (!isFileEntryType(entryType)) {
        if (files.length !== 0) {
            throw new HttpError(
                'ENTRY_FILE_UNEXPECTED',
                `Entry type ${entryType} does not accept a file`,
                400,
            )
        }

        const input = parseHttpInput(
            noteEntryBodySchema,
            rawFields,
            'ENTRY_INPUT_INVALID',
        )
        const entry = await request.server.services.entries.create(input)
        return reply.code(201).send(toEntryDto(entry))
    }

    const uploadedFile = files[0]
    if (
        files.length !== 1 ||
        uploadedFile === undefined ||
        uploadedFile.fieldName !== 'file'
    ) {
        throw new HttpError(
            'ENTRY_FILE_REQUIRED',
            'Exactly one file must be provided in the file field',
            400,
        )
    }

    const fields = parseHttpInput(
        fileBackedEntryFieldsSchema,
        {
            type: rawFields.type,
            folderId: rawFields.folderId,
            name: rawFields.name,
        },
        'ENTRY_INPUT_INVALID',
    )
    const preparedFile = await uploadedFile.prepare(12)
    const fileValidation = validateEntryFile(
        fields.type,
        {
            filename: uploadedFile.originalName,
            mimeType: uploadedFile.mimeType,
            size: preparedFile.size,
            header: preparedFile.header,
        },
        request.server.config.maxFileSizeBytes,
    )
    const entry = await request.server.services.entries.create({
        ...fields,
        file: {
            body: preparedFile.body,
            disposition: fileValidation.disposition,
            extension: fileValidation.extension,
            mimeType: uploadedFile.mimeType,
            originalName: uploadedFile.originalName,
            size: preparedFile.size,
        },
    })

    return reply.code(201).send(toEntryDto(entry))
}

export async function getFileHandler(
    request: FastifyRequest<{ Params: EntryParams }>,
    reply: FastifyReply,
) {
    const file = await request.server.services.entries.getFile(
        request.params.id,
    )

    return sendFile(reply, file)
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
                    'Create a note from JSON or a file-backed entry from multipart fields type, folderId, name and file.',
                response: {
                    201: entryDtoSchema,
                },
                summary: 'Create an entry',
                tags: ['entries'],
            },
        },
        createHandler,
    )

    api.get(
        '/entries/:id/file',
        {
            schema: {
                params: entryParamsSchema,
                produces: ['application/octet-stream'],
                summary: 'Download or view the file attached to an entry',
                tags: ['entries'],
            },
        },
        getFileHandler,
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
