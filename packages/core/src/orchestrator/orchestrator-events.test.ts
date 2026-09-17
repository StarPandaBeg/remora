import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
    Entry,
    EntryArtifactCreate,
    TaskRun,
    TaskStep,
} from '../database/schema.ts'
import type { RepositoryRegistry, TransactionRunner } from '../repositories.ts'
import { createCompletionServices } from './completion-services.ts'
import { createOrchestratorEvents } from './orchestrator-events.ts'

const now = new Date('2026-09-17T10:00:00.000Z')

function createEntry(): Entry {
    return {
        id: 20,
        folderId: 1,
        name: 'Lecture',
        type: 'video_record',
        content: null,
        metadata: {
            relatedTasks: [10],
            file: {
                bucket: 'media',
                objectKey: 'source/video.mp4',
                mimeType: 'video/mp4',
                originalName: 'video.mp4',
                size: 1024,
                recordId: 'record-1',
                url: 'https://core.example/v1/entries/20/file',
                disposition: 'inline',
            },
        },
        status: 'processing',
        createdAt: now,
        updatedAt: now,
    }
}

void describe('orchestrator completion dependencies', () => {
    void it('provides transaction-scoped repositories and services to callbacks', async () => {
        const entry = createEntry()
        const step: TaskStep = {
            id: 42,
            runId: 10,
            type: 'voice_recognition',
            status: 'running',
            input: {},
            output: {},
            error: {},
            context: { entry },
            position: 2,
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: null,
        }
        const task: TaskRun = {
            id: 10,
            entryId: entry.id,
            type: 'video_summary',
            status: 'running',
            config: {},
            pipelineVersion: 1,
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: null,
            steps: [step],
        }
        const rootRepositories = {
            tasks: {
                findStep: async () => step,
                findTask: async () => task,
            },
        } as unknown as RepositoryRegistry

        let transactionActive = false
        let artifactInput: EntryArtifactCreate | undefined
        let updatedStatus: Entry['status'] | undefined
        const transactionRepositories = {
            entries: {
                findById: async () => entry,
                updateStatus: async (_id: number, status: Entry['status']) => {
                    assert.equal(transactionActive, true)
                    updatedStatus = status
                    return { ...entry, status, artifacts: [] }
                },
            },
            entryArtifacts: {
                create: async (input: EntryArtifactCreate) => {
                    assert.equal(transactionActive, true)
                    artifactInput = input
                    return {
                        id: 1,
                        name: null,
                        metadata: {},
                        createdAt: now,
                        updatedAt: now,
                        ...input,
                    }
                },
            },
            tasks: {
                finishStep: async () => undefined,
                finishTask: async () => undefined,
            },
        } as unknown as RepositoryRegistry
        const transaction: TransactionRunner = async (work) => {
            transactionActive = true
            try {
                return await work(transactionRepositories)
            } finally {
                transactionActive = false
            }
        }
        const events = createOrchestratorEvents({
            repositories: rootRepositories,
            transaction,
            runNextStep: async () => undefined,
            createCompletionServices,
        })

        await events.handleWorkerEvent({
            type: 'task.completed',
            taskId: step.id,
            output: {
                bucket: 'artifacts',
                language: 'ru',
                transcriptionKey: 'transcriptions/20.json',
            },
        })

        assert.deepEqual(artifactInput, {
            entryId: entry.id,
            type: 'transcription',
            format: 'blob',
            name: 'Transcription',
            content: 'transcriptions/20.json',
            metadata: { bucket: 'artifacts', language: 'ru' },
        })
        assert.equal(updatedStatus, 'ready')
    })
})
