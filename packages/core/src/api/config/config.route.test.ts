import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
    serializerCompiler,
    validatorCompiler,
} from '@fastify/type-provider-zod'
import Fastify from 'fastify'

import type { ServiceRegistry } from '../../services.ts'
import type { JsonValue } from '../../types/json.ts'
import configApi from './config.route.ts'
import { getDefaultRuntimeConfig, isRuntimeConfigKey } from './config.ts'

async function createServer() {
    const defaults = getDefaultRuntimeConfig()
    const values: Record<string, JsonValue> = { ...defaults }
    const config = {
        getEffective: async () => ({ ...values }),
        update: async (patch: Record<string, JsonValue>) => {
            Object.assign(values, patch)
            return { ...values }
        },
        reset: async (key: string) => {
            if (isRuntimeConfigKey(key)) values[key] = defaults[key]
        },
    }
    const server = Fastify()
    server.setValidatorCompiler(validatorCompiler)
    server.setSerializerCompiler(serializerCompiler)
    server.decorate('services', { config } as unknown as ServiceRegistry)
    await server.register(configApi)
    await server.ready()
    return server
}

void describe('runtime config API', () => {
    void it('returns effective configuration', async () => {
        const server = await createServer()
        try {
            const response = await server.inject({
                method: 'GET',
                url: '/config',
            })

            assert.equal(response.statusCode, 200)
            assert.deepEqual(response.json(), getDefaultRuntimeConfig())
        } finally {
            await server.close()
        }
    })

    void it('partially updates configuration', async () => {
        const server = await createServer()
        try {
            const response = await server.inject({
                method: 'PATCH',
                url: '/config',
                payload: { 'video.frameInterval': 20 },
            })

            assert.equal(response.statusCode, 200)
            assert.deepEqual(response.json(), {
                ...getDefaultRuntimeConfig(),
                'video.frameInterval': 20,
            })
        } finally {
            await server.close()
        }
    })

    void it('resets one override', async () => {
        const server = await createServer()
        try {
            await server.inject({
                method: 'PATCH',
                url: '/config',
                payload: { 'video.frameInterval': 20 },
            })
            const reset = await server.inject({
                method: 'DELETE',
                url: '/config/video.frameInterval',
            })
            const effective = await server.inject({
                method: 'GET',
                url: '/config',
            })

            assert.equal(reset.statusCode, 204)
            assert.deepEqual(effective.json(), getDefaultRuntimeConfig())
        } finally {
            await server.close()
        }
    })
})
