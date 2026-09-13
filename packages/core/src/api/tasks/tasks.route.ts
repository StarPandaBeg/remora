import type { FastifyPluginCallback } from 'fastify'
import fastifyPlugin from 'fastify-plugin'

const tasksApi: FastifyPluginCallback = (fastify, _options, done) => {
    void fastify
    done()
}

export default fastifyPlugin(tasksApi, {
    fastify: '5.x',
    name: 'tasks-api',
})
