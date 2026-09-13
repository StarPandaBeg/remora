import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'

import type {
    Entry,
    EntryCreate,
    TaskRunCreate,
} from '../../database/schema.ts'
import type { RepositoryRegistry } from '../../repositories.ts'
import type {
    ObjectReference,
    ObjectStorage,
    PutObjectInput,
} from '../../storage/object-storage.ts'
import { toEntryDto } from './entries.dto.ts'
import { createEntryService } from './entries.service.ts'

function entryFrom(input: EntryCreate, id = 1): Entry {
    return {
        id,
        folderId: input.folderId,
        name: input.name,
        type: input.type,
        content: input.content ?? null,
        metadata: input.metadata ?? {},
        createdAt: new Date(0),
        updatedAt: new Date(0),
    }
}

function createRepositoryStub(options: {
    onCreate: (input: EntryCreate) => Entry | Promise<Entry>
    onCreateTask?: () => never
    taskEntry?: () => Entry | undefined
    createdTasks?: TaskRunCreate[]
    createdSteps?: string[]
}): RepositoryRegistry {
    const registry = {
        entries: {
            create: options.onCreate,
            folderExists: () => Promise.resolve(true),
            findById: () => Promise.resolve(options.taskEntry?.()),
        },
        tasks: {
            createTask: (task: TaskRunCreate) => {
                options.onCreateTask?.()
                options.createdTasks?.push(task)
                return Promise.resolve({ id: 10 })
            },
            createStep: (step: { type: string }) => {
                options.createdSteps?.push(step.type)
                return Promise.resolve(step)
            },
        },
        withDb: () => registry,
    }
    return registry as unknown as RepositoryRegistry
}

function createStorageStub(log: {
    uploaded?: PutObjectInput
    removed?: ObjectReference
}): ObjectStorage {
    return {
        ensureBucket: () => Promise.resolve(),
        putObject: (input) => {
            log.uploaded = input
            return Promise.resolve({
                bucket: 'videos',
                objectKey: input.objectKey,
            })
        },
        removeObject: (reference) => {
            log.removed = reference
            return Promise.resolve()
        },
    }
}

void describe('entry service', () => {
    void it('keeps note creation unchanged and returns metadata in the DTO', async () => {
        const storageLog: { uploaded?: PutObjectInput } = {}
        const repositories = createRepositoryStub({
            onCreate: (input) => entryFrom(input),
        })
        const service = createEntryService({
            repositories,
            storage: createStorageStub(storageLog),
            transaction: async (work) => await work(repositories),
        })

        const entry = await service.create({
            type: 'note',
            folderId: 2,
            name: 'Note',
            content: 'Body',
        })

        assert.equal(storageLog.uploaded, undefined)
        assert.deepEqual(toEntryDto(entry), {
            id: 1,
            folderId: 2,
            name: 'Note',
            type: 'note',
            content: 'Body',
            metadata: {},
        })
    })

    void it('stores a video, its metadata and a related task with pipeline steps', async () => {
        const storageLog: { uploaded?: PutObjectInput } = {}
        const tasks: TaskRunCreate[] = []
        const steps: string[] = []
        let createdEntry: Entry | undefined
        const repositories = createRepositoryStub({
            onCreate(input) {
                createdEntry = entryFrom(input, 42)
                return createdEntry
            },
            taskEntry: () => createdEntry,
            createdTasks: tasks,
            createdSteps: steps,
        })
        const service = createEntryService({
            repositories,
            storage: createStorageStub(storageLog),
            transaction: async (work) => await work(repositories),
            createId: () => 'asset-id',
        })

        const entry = await service.create({
            type: 'video_record',
            folderId: 2,
            name: 'Meeting',
            video: {
                body: Readable.from('video'),
                extension: '.mp4',
                mimeType: 'video/mp4',
                originalName: 'meeting.mp4',
                size: 5,
            },
        })

        assert.equal(
            storageLog.uploaded?.objectKey,
            'entries/video/asset-id/original.mp4',
        )
        assert.deepEqual(entry.metadata, {
            originalVideo: {
                bucket: 'videos',
                objectKey: 'entries/video/asset-id/original.mp4',
                mimeType: 'video/mp4',
                originalName: 'meeting.mp4',
                size: 5,
            },
        })
        assert.deepEqual(steps, ['media_prepare', 'transcript'])
        assert.deepEqual(tasks, [
            {
                type: 'video_record_summary',
                entryId: 42,
                status: 'pending',
                pipelineVersion: 1,
            },
        ])
    })

    void it('removes the uploaded object if task creation fails', async () => {
        const storageLog: {
            uploaded?: PutObjectInput
            removed?: ObjectReference
        } = {}
        let createdEntry: Entry | undefined
        const repositories = createRepositoryStub({
            onCreate(input) {
                createdEntry = entryFrom(input, 42)
                return createdEntry
            },
            taskEntry: () => createdEntry,
            onCreateTask: () => {
                throw new Error('database failed')
            },
        })
        const service = createEntryService({
            repositories,
            storage: createStorageStub(storageLog),
            transaction: async (work) => await work(repositories),
            createId: () => 'failed-asset',
        })

        await assert.rejects(
            service.create({
                type: 'video_record',
                folderId: 2,
                name: 'Meeting',
                video: {
                    body: Readable.from('video'),
                    extension: '.mov',
                    mimeType: 'video/quicktime',
                    originalName: 'meeting.mov',
                    size: 5,
                },
            }),
            /database failed/,
        )
        assert.deepEqual(storageLog.removed, {
            bucket: 'videos',
            objectKey: 'entries/video/failed-asset/original.mov',
        })
    })
})
