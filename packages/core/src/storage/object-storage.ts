import type { Readable } from 'node:stream'

export interface ObjectReference {
    bucket: string
    objectKey: string
}

export interface PutObjectInput {
    objectKey: string
    body: Readable
    size: number
    contentType: string
}

export interface ObjectStorage {
    ensureBucket: () => Promise<void>
    putObject: (input: PutObjectInput) => Promise<ObjectReference>
    removeObject: (reference: ObjectReference) => Promise<void>
}

export class StorageCompensationError extends AggregateError {
    readonly reference: ObjectReference

    constructor(
        operationError: unknown,
        cleanupError: unknown,
        reference: ObjectReference,
    ) {
        super(
            [operationError, cleanupError],
            `Database operation failed and uploaded object ${reference.bucket}/${reference.objectKey} could not be removed`,
        )
        this.name = 'StorageCompensationError'
        this.reference = reference
    }
}
