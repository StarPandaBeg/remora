import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Entry, TaskRun } from '../../database/schema.ts'
import type { Orchestrator } from '../../orchestrator/orchestrator.ts'
import type {
    RepositoryRegistry,
    TransactionRunner,
} from '../../repositories.ts'
import { createEntryService } from './entries.service.ts'
import type { EntryFileService } from './entry-files.service.ts'

const now = new Date('2026-09-14T10:00:00.000Z')

void describe('entry task creation', () => {
    void it('stores related task ids and starts tasks after commit', async () => {
        const initialEntry: Entry = {
            id: 5,
            folderId: 2,
            name: 'Video',
            type: 'video_record',
            content: null,
            metadata: { relatedTasks: [] },
            status: 'ready',
            createdAt: now,
            updatedAt: now,
        }
        const task: TaskRun = {
            id: 17,
            entryId: initialEntry.id,
            type: 'video_summary',
            status: 'pending',
            config: {},
            pipelineVersion: 1,
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            finishedAt: null,
        }
        let transactionCommitted = false
        let startedTask: TaskRun | undefined
        let currentStatus = initialEntry.status

        const repositories = {
            entries: {
                folderExists: async () => true,
                create: async () => initialEntry,
                updateMetadata: async (
                    _id: number,
                    metadata: Entry['metadata'],
                ) => ({ ...initialEntry, metadata, status: currentStatus }),
                updateStatus: async (_id: number, status: Entry['status']) => {
                    currentStatus = status
                    return { ...initialEntry, status }
                },
            },
        } as unknown as RepositoryRegistry
        const transaction: TransactionRunner = async (work) => {
            const result = await work(repositories)
            transactionCommitted = true
            return result
        }
        const transactionalOrchestrator = {
            applicableTaskTypes: () => ['video_summary'],
            createTaskForEntry: async () => task,
        }
        const orchestrator = {
            withRepositories: () => transactionalOrchestrator,
            runTask: async (createdTask: TaskRun) => {
                assert.equal(transactionCommitted, true)
                startedTask = createdTask
            },
        } as unknown as Orchestrator
        const service = createEntryService({
            files: {} as EntryFileService,
            repositories,
            transaction,
            orchestrator,
        })

        const entry = await service.create({
            type: 'note',
            folderId: initialEntry.folderId,
            name: initialEntry.name,
            content: 'Content',
        })

        assert.deepEqual(entry.metadata.relatedTasks, [task.id])
        assert.equal(entry.status, 'processing')
        assert.equal(startedTask, task)
    })
})

void describe('entry status update', () => {
    void it('updates status through the dedicated repository method', async () => {
        const updatedEntry: Entry & { artifacts: [] } = {
            id: 5,
            folderId: 2,
            name: 'Video',
            type: 'video_record',
            content: null,
            metadata: { relatedTasks: [] },
            status: 'ready',
            artifacts: [],
            createdAt: now,
            updatedAt: now,
        }
        let receivedStatus: Entry['status'] | undefined
        const repositories = {
            entries: {
                updateStatus: async (_id: number, status: Entry['status']) => {
                    receivedStatus = status
                    return updatedEntry
                },
            },
        } as unknown as RepositoryRegistry
        const service = createEntryService({
            files: {} as EntryFileService,
            repositories,
            transaction: {} as TransactionRunner,
            orchestrator: {} as Orchestrator,
        })

        assert.equal(await service.updateStatus(5, 'ready'), updatedEntry)
        assert.equal(receivedStatus, 'ready')
    })
})
