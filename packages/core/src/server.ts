import process from 'node:process'

import Fastify from 'fastify'

import app from './app.ts'
import { loadConfig } from './config.ts'

const server = Fastify({ logger: true })
const config = loadConfig()

await server.register(app, { config })

try {
    await server.listen({ host: config.host, port: config.port })
} catch (error) {
    server.log.error(error)
    process.exitCode = 1
}
