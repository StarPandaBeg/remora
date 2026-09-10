import process from 'node:process'

import Fastify from 'fastify'

import app from './app.ts'

const server = Fastify({ logger: true })

await server.register(app)

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const host = process.env.HOST ?? '127.0.0.1'

try {
    await server.listen({ host, port })
} catch (error) {
    server.log.error(error)
    process.exitCode = 1
}
