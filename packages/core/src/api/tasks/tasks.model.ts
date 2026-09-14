import { eq } from 'drizzle-orm'
import type { DbExecutor } from '../../database/index.ts'
import {
    taskRuns,
    taskSteps,
    type ProcessingStatus,
    type ProcessingStepStatus,
    type TaskRunCreate,
    type TaskStepCreate,
} from '../../database/schema.ts'

export function createTaskRepository(db: DbExecutor) {
    const _finishTask = async (id: number, status: ProcessingStatus) => {
        const [entry] = await db
            .update(taskRuns)
            .set({
                status,
                updatedAt: new Date(),
                finishedAt: new Date(),
            })
            .where(eq(taskRuns.id, id))
            .returning()
        return entry
    }

    const createTask = async (data: TaskRunCreate) => {
        const [entry] = await db
            .insert(taskRuns)
            .values({ pipelineVersion: 1, ...data })
            .returning()
        return entry
    }

    const createStep = async (data: TaskStepCreate) => {
        const [entry] = await db.insert(taskSteps).values(data).returning()
        return entry
    }

    const findTask = async (id: number) => {
        return await db.query.taskRuns.findFirst({
            where: { id },
            with: { steps: true },
        })
    }

    const findTasks = async (statuses?: ProcessingStatus[]) => {
        return await db.query.taskRuns.findMany({
            where: statuses ? { status: { in: statuses } } : undefined,
            with: { steps: true },
        })
    }

    const findStep = async (id: number) => {
        return await db.query.taskSteps.findFirst({
            where: { id },
            with: { task: true },
        })
    }

    const updateTaskStatus = async (id: number, status: ProcessingStatus) => {
        const [entry] = await db
            .update(taskRuns)
            .set({ status, updatedAt: new Date() })
            .where(eq(taskRuns.id, id))
            .returning()
        return entry
    }

    const updateStepStatus = async (
        id: number,
        status: ProcessingStepStatus,
    ) => {
        const [entry] = await db
            .update(taskSteps)
            .set({ status, updatedAt: new Date() })
            .where(eq(taskSteps.id, id))
            .returning()
        return entry
    }

    const startTask = async (id: number) => {
        const [entry] = await db
            .update(taskRuns)
            .set({
                status: 'running',
                updatedAt: new Date(),
                startedAt: new Date(),
            })
            .where(eq(taskRuns.id, id))
            .returning()
        return entry
    }
    const haltTask = (id: number) => _finishTask(id, 'failed')
    const cancelTask = (id: number) => _finishTask(id, 'cancelled')
    const finishTask = (id: number) => _finishTask(id, 'completed')

    const setStepContext = async (id: number, context: object) => {
        const [entry] = await db
            .update(taskSteps)
            .set({
                context,
                updatedAt: new Date(),
            })
            .where(eq(taskSteps.id, id))
            .returning()
        return entry
    }

    const enqueueStep = async (id: number, input: object) => {
        const [entry] = await db
            .update(taskSteps)
            .set({
                input,
                updatedAt: new Date(),
                startedAt: new Date(),
                status: 'queued',
            })
            .where(eq(taskSteps.id, id))
            .returning()
        return entry
    }

    const haltStep = async (id: number, error: object) => {
        const [entry] = await db
            .update(taskSteps)
            .set({
                error,
                updatedAt: new Date(),
                finishedAt: new Date(),
                status: 'failed',
            })
            .where(eq(taskSteps.id, id))
            .returning()
        return entry
    }

    const finishStep = async (id: number, output: object) => {
        const [entry] = await db
            .update(taskSteps)
            .set({
                output,
                updatedAt: new Date(),
                finishedAt: new Date(),
                status: 'completed',
            })
            .where(eq(taskSteps.id, id))
            .returning()
        return entry
    }

    return {
        createTask,
        createStep,
        findTask,
        findTasks,
        findStep,
        updateTaskStatus,
        updateStepStatus,
        startTask,
        haltTask,
        cancelTask,
        finishTask,
        enqueueStep,
        haltStep,
        finishStep,
        setStepContext,
    }
}
