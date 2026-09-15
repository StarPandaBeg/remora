import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getDefaultRuntimeConfig } from '../api/config/config.ts'
import type { RuntimeConfig } from '../api/config/types.ts'
import type {
    Entry,
    TaskRun,
    TaskRunCreate,
    TaskStep,
} from '../database/schema.ts'
import type { RepositoryRegistry, TransactionRunner } from '../repositories.ts'
import {
    createOrchestrator,
    type RuntimeConfigProvider,
} from './orchestrator.ts'
import { VideoRecordSummaryTask } from './tasks/video-summary/video-summary.task.ts'
import type { WorkerTaskCommand } from './worker.ts'

const now = new Date('2026-09-14T10:00:00.000Z')

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
                bucket: 'remora',
                objectKey: 'entries/video.mp4',
                mimeType: 'video/mp4',
                originalName: 'video.mp4',
                size: 1024,
                recordId: 'record-1',
                url: 'https://core.example/v1/entries/20/file',
                disposition: 'inline',
            },
        },
        createdAt: now,
        updatedAt: now,
    }
}

function createRunningTask(): TaskRun & { steps: TaskStep[] } {
    const step: TaskStep = {
        id: 42,
        runId: 10,
        type: 'media_prepare',
        status: 'blocked',
        input: {},
        output: {},
        error: {},
        context: { entry: createEntry() },
        position: 0,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
    }

    return {
        id: 10,
        entryId: 20,
        type: 'video_summary',
        status: 'running',
        config: { language: 'ru' },
        pipelineVersion: 1,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: null,
        steps: [step],
    }
}

interface HarnessOptions {
    execute: (command: WorkerTaskCommand) => Promise<void>
    haltStep?: () => Promise<void>
    haltTask?: () => Promise<void>
}

function createRuntimeConfigStub() {
    const service = {
        getEffective: async () => getDefaultRuntimeConfig(),
        withRepositories: () => service,
    }
    return service
}

function createHarness(options: HarnessOptions) {
    const task = createRunningTask()
    const calls: string[] = []
    let enqueuedInput: object | undefined
    let stepError: object | undefined

    const repositories = {
        tasks: {
            findTask: async () => task,
            enqueueStep: async (_id: number, input: object) => {
                calls.push('enqueueStep')
                enqueuedInput = input
            },
            haltStep: async (_id: number, error: object) => {
                calls.push('haltStep')
                stepError = error
                await options.haltStep?.()
            },
            haltTask: async () => {
                calls.push('haltTask')
                await options.haltTask?.()
            },
        },
    } as unknown as RepositoryRegistry
    const transaction: TransactionRunner = async (work) =>
        await work(repositories)
    const orchestrator = createOrchestrator(
        repositories,
        transaction,
        {
            execute: async (command) => {
                calls.push('execute')
                await options.execute(command)
            },
        },
        createRuntimeConfigStub(),
    )

    return {
        calls,
        getEnqueuedInput: () => enqueuedInput,
        getStepError: () => stepError,
        orchestrator,
    }
}

void describe('orchestrator worker dispatch', () => {
    void it('dispatches the first step after the task transaction commits', async () => {
        const runningTask = createRunningTask()
        const pendingTask: TaskRun = {
            ...runningTask,
            status: 'pending',
            startedAt: null,
        }
        let transactionActive = false
        let startCalledInTransaction = false
        let executeCalledInTransaction = false
        const repositories = {
            tasks: {
                startTask: async () => {
                    startCalledInTransaction = transactionActive
                },
                findTask: async () => runningTask,
                enqueueStep: async () => undefined,
            },
        } as unknown as RepositoryRegistry
        const transaction: TransactionRunner = async (work) => {
            transactionActive = true
            try {
                return await work(repositories)
            } finally {
                transactionActive = false
            }
        }
        const orchestrator = createOrchestrator(
            repositories,
            transaction,
            {
                execute: async () => {
                    executeCalledInTransaction = transactionActive
                },
            },
            createRuntimeConfigStub(),
        )

        await orchestrator.runTask(pendingTask)

        assert.equal(startCalledInTransaction, true)
        assert.equal(executeCalledInTransaction, false)
    })

    void it('executes an enqueued step with task config', async () => {
        let receivedCommand: WorkerTaskCommand | undefined
        const harness = createHarness({
            execute: async (command) => {
                receivedCommand = command
            },
        })

        await harness.orchestrator.runNextStep(10)

        const expectedInput = {
            source: {
                bucket: 'remora',
                objectKey: 'entries/video.mp4',
            },
            mimetype: 'video/mp4',
            recordId: 'record-1',
        }
        assert.deepEqual(harness.getEnqueuedInput(), expectedInput)
        assert.deepEqual(receivedCommand, {
            pipeline: 'video_summary',
            type: 'media_prepare',
            taskId: 42,
            input: expectedInput,
            config: { language: 'ru' },
        })
        assert.deepEqual(harness.calls, ['enqueueStep', 'execute'])
    })

    void it('marks the step and task as failed when dispatch fails', async () => {
        const harness = createHarness({
            execute: async () => {
                throw new Error('worker unavailable')
            },
        })

        await harness.orchestrator.runNextStep(10)

        assert.deepEqual(harness.getStepError(), {
            code: 'WORKER_EXECUTE_FAILED',
            message: 'worker unavailable',
        })
        assert.deepEqual(harness.calls, [
            'enqueueStep',
            'execute',
            'haltStep',
            'haltTask',
        ])
    })

    void it('reports a failure to persist the failed task state', async () => {
        const persistenceError = new Error('database unavailable')
        const harness = createHarness({
            execute: async () => {
                throw new Error('worker unavailable')
            },
            haltTask: async () => {
                throw persistenceError
            },
        })

        await assert.rejects(
            harness.orchestrator.runNextStep(10),
            (error: unknown) => {
                assert.ok(error instanceof AggregateError)
                assert.match(error.message, /could not be marked as failed/)
                assert.ok(error.errors.includes(persistenceError))
                return true
            },
        )
        assert.ok(harness.calls.includes('haltStep'))
    })
})

void describe('task configuration snapshot', () => {
    void it('lets the task definition select only its pipeline settings', () => {
        const globalConfig: RuntimeConfig & { 'unrelated.setting': boolean } = {
            'video_record.prefer_source': true,
            'unrelated.setting': true,
        }

        assert.deepEqual(VideoRecordSummaryTask.selectConfig(globalConfig), {
            'video_record.prefer_source': true,
        })
    })

    void it('stores one snapshot per task and preserves existing snapshots', async () => {
        let effective: RuntimeConfig = {
            'video_record.prefer_source': false,
        }
        const created: TaskRunCreate[] = []
        const repositories = {
            tasks: {
                createTask: async (data: TaskRunCreate) => {
                    created.push(data)
                    return {
                        id: created.length,
                        ...data,
                        config: data.config ?? {},
                        status: data.status ?? 'pending',
                        pipelineVersion: data.pipelineVersion ?? 1,
                        createdAt: now,
                        updatedAt: now,
                        startedAt: null,
                        finishedAt: null,
                    } as TaskRun
                },
                createStep: async () => undefined,
            },
        } as unknown as RepositoryRegistry
        const transaction: TransactionRunner = async (work) =>
            await work(repositories)
        const runtimeConfig: RuntimeConfigProvider = {
            getEffective: async () => ({ ...effective }),
            withRepositories: () => runtimeConfig,
        }
        const orchestrator = createOrchestrator(
            repositories,
            transaction,
            { execute: async () => undefined },
            runtimeConfig,
        )

        const first = await orchestrator.createTaskForEntry(
            createEntry(),
            'video_summary',
        )

        effective = {
            'video_record.prefer_source': true,
        }
        const second = await orchestrator.createTaskForEntry(
            createEntry(),
            'video_summary',
        )

        assert.deepEqual(first.config, {
            'video_record.prefer_source': false,
        })
        assert.deepEqual(second.config, {
            'video_record.prefer_source': true,
        })
        assert.deepEqual(first.config, created[0]?.config)
    })
})
