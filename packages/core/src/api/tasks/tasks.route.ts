import { createHash, timingSafeEqual } from 'node:crypto'

import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type {
    FastifyPluginCallback,
    FastifyReply,
    FastifyRequest,
} from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'

import { processingStatus } from '../../database/schema.ts'
import type { WorkerEvent } from '../../orchestrator/worker.ts'
import { HttpError } from '../../util/error.ts'
import { taskDtoSchema, toTaskDto } from './tasks.dto.ts'

export const workerSecretHeader = 'x-worker-secret'
const taskIdSchema = z.coerce.number().int().positive()
const taskStatusSchema = z.enum(processingStatus.enumValues)

export const getTasksQuerySchema = z.object({
    statuses: z
        .union([taskStatusSchema, z.array(taskStatusSchema).min(1)])
        .optional(),
})

export const taskParamsSchema = z.object({
    id: taskIdSchema,
})

const workerEventDataSchema = z.record(z.string(), z.unknown())

export const workerEventSchema: z.ZodType<WorkerEvent> = z.discriminatedUnion(
    'type',
    [
        z.strictObject({
            type: z.literal('task.started'),
            taskId: taskIdSchema,
        }),
        z.strictObject({
            type: z.literal('task.progress'),
            taskId: taskIdSchema,
            progress: z.number().finite(),
            totalSteps: z.number().int().positive().optional(),
            step: z.number().int().positive().optional(),
            stepName: z.string().min(1).optional(),
            stepProgress: z.number().min(0).max(100).optional(),
        }),
        z.strictObject({
            type: z.literal('task.completed'),
            taskId: taskIdSchema,
            output: workerEventDataSchema,
        }),
        z.strictObject({
            type: z.literal('task.failed'),
            taskId: taskIdSchema,
            error: workerEventDataSchema,
        }),
    ],
)

type TaskParams = z.output<typeof taskParamsSchema>
type GetTasksQuery = z.output<typeof getTasksQuerySchema>

function secretDigest(secret: string): Buffer {
    return createHash('sha256').update(secret, 'utf8').digest()
}

export function isWorkerCallbackAuthorized(
    providedSecret: string | string[] | undefined,
    expectedSecret: string | null,
): boolean {
    if (typeof providedSecret !== 'string' || expectedSecret === null) {
        return false
    }

    return timingSafeEqual(
        secretDigest(providedSecret),
        secretDigest(expectedSecret),
    )
}

export async function authenticateWorkerCallback(request: FastifyRequest) {
    if (
        !isWorkerCallbackAuthorized(
            request.headers[workerSecretHeader],
            request.server.config.workerCallbackSecret,
        )
    ) {
        throw new HttpError(
            'WORKER_CALLBACK_UNAUTHORIZED',
            'Worker callback secret is missing or invalid',
            401,
        )
    }
}

export async function workerEventHandler(
    request: FastifyRequest<{ Body: WorkerEvent }>,
    reply: FastifyReply,
) {
    await request.server.services.tasks.handleWorkerEvent(request.body)
    return reply.code(204).send()
}

export async function getTasksHandler(
    request: FastifyRequest<{ Querystring: GetTasksQuery }>,
) {
    const { statuses } = request.query
    const tasks = await request.server.services.tasks.getAll(
        statuses === undefined
            ? undefined
            : Array.isArray(statuses)
              ? statuses
              : [statuses],
    )

    return tasks.map(toTaskDto)
}

export async function getTaskHandler(
    request: FastifyRequest<{ Params: TaskParams }>,
) {
    const task = await request.server.services.tasks.getById(request.params.id)

    return toTaskDto(task)
}

export async function startTaskHandler(
    request: FastifyRequest<{ Params: TaskParams }>,
) {
    const task = await request.server.services.tasks.start(request.params.id)

    return toTaskDto(task)
}

const tasksApi: FastifyPluginCallback = (fastify, _options, done) => {
    const api = fastify.withTypeProvider<ZodTypeProvider>()

    api.get(
        '/tasks',
        {
            schema: {
                querystring: getTasksQuerySchema,
                response: {
                    200: z.array(taskDtoSchema),
                },
                summary: 'Get tasks',
                tags: ['tasks'],
            },
        },
        getTasksHandler,
    )

    api.post(
        '/tasks/events',
        {
            onRequest: authenticateWorkerCallback,
            schema: {
                body: workerEventSchema,
                security: [{ workerCallbackSecret: [] }],
                summary: 'Receive an event from a worker',
                tags: ['tasks'],
            },
        },
        workerEventHandler,
    )

    api.get(
        '/tasks/:id',
        {
            schema: {
                params: taskParamsSchema,
                response: {
                    200: taskDtoSchema,
                },
                summary: 'Get a task and its steps',
                tags: ['tasks'],
            },
        },
        getTaskHandler,
    )

    api.post(
        '/tasks/:id/start',
        {
            schema: {
                params: taskParamsSchema,
                response: {
                    200: taskDtoSchema,
                },
                summary: 'Start a task',
                tags: ['tasks'],
            },
        },
        startTaskHandler,
    )

    done()
}

export default fastifyPlugin(tasksApi, {
    fastify: '5.x',
    name: 'tasks-api',
})
