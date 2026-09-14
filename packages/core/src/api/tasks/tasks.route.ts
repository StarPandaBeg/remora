import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyPluginCallback, FastifyRequest } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { z } from 'zod/v4'

import { processingStatus } from '../../database/schema.ts'
import { taskDtoSchema, toTaskDto } from './tasks.dto.ts'

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

type TaskParams = z.output<typeof taskParamsSchema>
type GetTasksQuery = z.output<typeof getTasksQuerySchema>

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
