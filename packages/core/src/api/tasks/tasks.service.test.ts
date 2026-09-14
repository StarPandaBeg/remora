import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { TaskRun, TaskStep } from '../../database/schema.ts'
import { HttpError } from '../../util/error.ts'
import { toTaskDto } from './tasks.dto.ts'
import { createTaskService } from './tasks.service.ts'

const now = new Date('2026-09-14T10:00:00.000Z')
type TaskWithSteps = TaskRun & { steps: TaskStep[] }

function createStep(position: number): TaskStep {
    return {
        id: position + 1,
        runId: 10,
        type: `step_${position}`,
        status: 'blocked',
        input: {},
        output: {},
        error: {},
        context: {},
        position,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
    }
}

function createTask(overrides: Partial<TaskWithSteps> = {}): TaskWithSteps {
    return {
        id: 10,
        entryId: 20,
        type: 'video_summary',
        status: 'pending',
        config: {},
        pipelineVersion: 1,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
        steps: [createStep(1), createStep(0)],
        ...overrides,
    }
}

void describe('task service', () => {
    void it('returns TASK_NOT_FOUND for an unknown task', async () => {
        const service = createTaskService({
            repositories: {
                tasks: {
                    findTask: async () => undefined,
                    findTasks: async () => [],
                },
            },
            orchestrator: { runTask: async () => undefined },
        })

        await assert.rejects(service.getById(404), (error: unknown) => {
            assert.ok(error instanceof HttpError)
            assert.equal(error.code, 'TASK_NOT_FOUND')
            assert.equal(error.statusCode, 404)
            return true
        })
    })

    void it('runs a task through the orchestrator and returns fresh state', async () => {
        const pendingTask = createTask()
        const runningTask = createTask({
            status: 'running',
            startedAt: now,
        })
        let findCalls = 0
        let startedTask: TaskRun | undefined
        const service = createTaskService({
            repositories: {
                tasks: {
                    findTask: async () =>
                        ++findCalls === 1 ? pendingTask : runningTask,
                    findTasks: async () => [],
                },
            },
            orchestrator: {
                runTask: async (task) => {
                    startedTask = task
                },
            },
        })

        const result = await service.start(pendingTask.id)

        assert.equal(startedTask, pendingTask)
        assert.equal(result, runningTask)
        assert.equal(findCalls, 2)
    })

    void it('passes task statuses to the repository', async () => {
        const tasks = [createTask(), createTask({ id: 11 })]
        let receivedStatuses: TaskRun['status'][] | undefined
        const service = createTaskService({
            repositories: {
                tasks: {
                    findTask: async () => undefined,
                    findTasks: async (statuses) => {
                        receivedStatuses = statuses
                        return tasks
                    },
                },
            },
            orchestrator: { runTask: async () => undefined },
        })

        const result = await service.getAll(['pending', 'failed'])

        assert.deepEqual(receivedStatuses, ['pending', 'failed'])
        assert.equal(result, tasks)
    })
})

void describe('task DTO', () => {
    void it('orders steps by pipeline position and serializes timestamps', () => {
        const dto = toTaskDto(createTask())

        assert.deepEqual(
            dto.steps.map((step) => step.position),
            [0, 1],
        )
        assert.equal(dto.createdAt, now.toISOString())
        assert.equal(dto.startedAt, null)
    })
})
