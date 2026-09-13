import fastifyPlugin from 'fastify-plugin'
import { database } from '../database/index.ts'

export default fastifyPlugin(function dbPlugin(fastify) {
    fastify.decorate('db', database)
})
