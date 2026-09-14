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

        const repositories = {
            entries: {
                folderExists: async () => true,
                create: async () => initialEntry,
                updateMetadata: async (
                    _id: number,
                    metadata: Entry['metadata'],
                ) => ({ ...initialEntry, metadata }),
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
        assert.equal(startedTask, task)
    })
})
