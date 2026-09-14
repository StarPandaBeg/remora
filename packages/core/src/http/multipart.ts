import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Readable } from 'node:stream'

import type { FastifyRequest } from 'fastify'

import { HttpError } from '../util/error.ts'

export interface PreparedMultipartFile {
    body: Readable
    header: Buffer
    size: number
}

export interface MultipartFile {
    fieldName: string
    mimeType: string
    originalName: string
    prepare: (headerBytes?: number) => Promise<PreparedMultipartFile>
}

export interface MultipartForm {
    fields: Record<string, unknown>
    files: MultipartFile[]
}

function fieldValue(value: unknown, fieldName: string): unknown {
    if (Array.isArray(value)) {
        throw new HttpError(
            'MULTIPART_FIELD_DUPLICATED',
            `Multipart field ${fieldName} must be provided only once`,
            400,
        )
    }
    if (
        value === null ||
        typeof value !== 'object' ||
        !('type' in value) ||
        value.type !== 'field' ||
        !('value' in value)
    ) {
        return undefined
    }
    return value.value
}

async function prepareFile(
    filepath: string,
    headerBytes: number,
): Promise<PreparedMultipartFile> {
    const fileInfo = await stat(filepath)
    const header = Buffer.alloc(headerBytes)
    const file = await open(filepath, 'r')

    try {
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        return {
            body: createReadStream(filepath),
            header: header.subarray(0, bytesRead),
            size: fileInfo.size,
        }
    } finally {
        await file.close()
    }
}

export async function readMultipartForm(
    request: FastifyRequest,
): Promise<MultipartForm> {
    const { files, values } = await request.saveRequestFiles()
    const fields: Record<string, unknown> = {}
    for (const [fieldName, value] of Object.entries(values)) {
        const parsedValue = fieldValue(value, fieldName)
        if (parsedValue !== undefined) fields[fieldName] = parsedValue
    }

    return {
        fields,
        files: files.map((file) => ({
            fieldName: file.fieldname,
            mimeType: file.mimetype,
            originalName: basename(file.filename),
            prepare: async (headerBytes = 0) =>
                await prepareFile(file.filepath, headerBytes),
        })),
    }
}
