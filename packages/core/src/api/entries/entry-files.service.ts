import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'

import type {
    EntryMetadata,
    StoredFileMetadata,
} from '../../database/schema.ts'
import {
    StorageCompensationError,
    type ObjectStorage,
} from '../../storage/object-storage.ts'
import { HttpError } from '../../util/error.ts'

export interface EntryFileUpload {
    body: Readable
    disposition: 'inline' | 'attachment'
    extension: string
    mimeType: string
    originalName: string
    size: number
}

export interface OpenedEntryFile extends StoredFileMetadata {
    body: Readable
}

export type UploadedEntryFile = Omit<StoredFileMetadata, 'url'>

interface EntryFileServiceDependencies {
    storage: ObjectStorage
    publicBaseUrl: string
    createId?: () => string
}

export function createEntryFileService({
    storage,
    publicBaseUrl,
    createId = randomUUID,
}: EntryFileServiceDependencies) {
    const upload = async (file: EntryFileUpload) => {
        const recordId = createId()
        const reference = await storage.putObject({
            objectKey: `entries/files/${recordId}/original${file.extension}`,
            body: file.body,
            size: file.size,
            contentType: file.mimeType,
        })

        return {
            ...reference,
            recordId,
            mimeType: file.mimeType,
            originalName: file.originalName,
            size: file.size,
            disposition: file.disposition,
        } satisfies UploadedEntryFile
    }

    const remove = async (file: UploadedEntryFile) => {
        await storage.removeObject({
            bucket: file.bucket,
            objectKey: file.objectKey,
        })
    }

    const uploadAndPersist = async <T>(
        file: EntryFileUpload,
        persist: (file: UploadedEntryFile) => Promise<T>,
    ) => {
        const storedFile = await upload(file)
        try {
            return await persist(storedFile)
        } catch (operationError) {
            try {
                await remove(storedFile)
            } catch (cleanupError) {
                throw new StorageCompensationError(
                    operationError,
                    cleanupError,
                    storedFile,
                )
            }
            throw operationError
        }
    }

    const metadataForEntry = (
        file: UploadedEntryFile,
        entryId: number,
    ): EntryMetadata => ({
        relatedTasks: [],
        file: {
            ...file,
            url: `${publicBaseUrl}/v1/entries/${entryId}/file`,
        },
    })

    const open = async (metadata: EntryMetadata): Promise<OpenedEntryFile> => {
        const file = metadata.file
        if (file === undefined) {
            throw new HttpError(
                'ENTRY_FILE_NOT_FOUND',
                'The entry does not have an attached file',
            )
        }

        return {
            ...file,
            body: await storage.getObject({
                bucket: file.bucket,
                objectKey: file.objectKey,
            }),
        }
    }

    return { metadataForEntry, open, remove, upload, uploadAndPersist }
}

export type EntryFileService = ReturnType<typeof createEntryFileService>
