import { extname } from 'node:path'

import type { Entry } from '../database/schema.ts'
import { HttpError } from '../util/error.ts'

interface FileFormatDefinition {
    extension: string
    mimeTypes: readonly string[]
    hasValidHeader: (header: Buffer) => boolean
}

interface FileEntryDefinition {
    disposition: 'inline' | 'attachment'
    formats?: readonly FileFormatDefinition[]
}

const isIsoBaseMedia = (header: Buffer) =>
    header.length >= 12 && header.toString('ascii', 4, 8) === 'ftyp'

/** File validation belongs to entry types, independently from task pipelines. */
export const fileEntryRegistry = {
    video_record: {
        disposition: 'inline',
        formats: [
            {
                extension: '.mp4',
                mimeTypes: ['video/mp4'],
                hasValidHeader: isIsoBaseMedia,
            },
            {
                extension: '.mov',
                mimeTypes: ['video/quicktime', 'video/x-quicktime'],
                hasValidHeader: isIsoBaseMedia,
            },
        ],
    },
    file: {
        disposition: 'inline',
    },
} satisfies Partial<Record<Entry['type'], FileEntryDefinition>>

export type FileEntryType = keyof typeof fileEntryRegistry

export function isFileEntryType(
    entryType: Entry['type'],
): entryType is FileEntryType {
    return entryType in fileEntryRegistry
}

export interface EntryFileDescription {
    filename: string
    mimeType: string
    size: number
    header: Buffer
}

export interface EntryFileValidationResult {
    disposition: 'inline' | 'attachment'
    extension: string
}

export function validateEntryFile(
    entryType: FileEntryType,
    file: EntryFileDescription,
    maxSize: number,
): EntryFileValidationResult {
    const definition: FileEntryDefinition | undefined =
        fileEntryRegistry[entryType]
    if (definition === undefined) {
        throw new HttpError(
            'ENTRY_FILE_UNSUPPORTED',
            `Entry type ${entryType as string} does not accept file uploads`,
            400,
        )
    }
    if (file.size <= 0) {
        throw new HttpError('ENTRY_FILE_EMPTY', 'The file is empty', 400)
    }
    if (file.size > maxSize) {
        throw new HttpError(
            'ENTRY_FILE_TOO_LARGE',
            `The file exceeds the ${maxSize} byte limit`,
            413,
        )
    }

    const extension = extname(file.filename).toLowerCase()
    if (definition.formats === undefined) {
        return {
            disposition: definition.disposition,
            extension: /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : '',
        }
    }

    const format = definition.formats.find(
        (candidate) =>
            candidate.extension === extension &&
            candidate.mimeTypes.includes(file.mimeType),
    )
    if (format === undefined) {
        throw new HttpError(
            'ENTRY_FILE_FORMAT_UNSUPPORTED',
            `The file format is not supported for entry type ${entryType}`,
            415,
        )
    }
    if (!format.hasValidHeader(file.header)) {
        throw new HttpError(
            'ENTRY_FILE_CONTENT_INVALID',
            'The uploaded file content does not match its declared format',
            400,
        )
    }

    return {
        disposition: definition.disposition,
        extension: format.extension,
    }
}
