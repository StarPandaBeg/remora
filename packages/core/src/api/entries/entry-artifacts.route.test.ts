import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
    serializerCompiler,
    validatorCompiler,
} from '@fastify/type-provider-zod'
import Fastify from 'fastify'

import type { EntryArtifact } from '../../database/schema.ts'
import type { ServiceRegistry } from '../../services.ts'
import { entryArtifactDtoSchema } from './entry-artifacts.dto.ts'
import entryArtifactsApi from './entry-artifacts.route.ts'

const now = new Date('2026-09-17T10:00:00.000Z')
const artifact: EntryArtifact = {
    id: 11,
    entryId: 5,
    type: 'transcription',
    format: 'text',
    name: 'Transcript',
    content: 'Initial content',
    metadata: { language: 'ru' },
    createdAt: now,
    updatedAt: now,
}

async function createServer() {
    let updatedInput: unknown
    const entryArtifacts = {
        getById: async () => artifact,
        updateText: async (_id: number, input: unknown) => {
            updatedInput = input
            return { ...artifact, ...(input as object) }
        },
    }
    const server = Fastify()
    server.setValidatorCompiler(validatorCompiler)
    server.setSerializerCompiler(serializerCompiler)
    server.decorate('services', {
        entryArtifacts,
    } as unknown as ServiceRegistry)
    await server.register(entryArtifactsApi)
    await server.ready()
    return { server, updatedInput: () => updatedInput }
}

void describe('entry artifacts API', () => {
    void it('returns an artifact by id', async () => {
        const { server } = await createServer()
        try {
            const response = await server.inject({
                method: 'GET',
                url: `/entry-artifacts/${artifact.id}`,
            })

            assert.equal(response.statusCode, 200)
            assert.deepEqual(response.json(), {
                id: artifact.id,
                entryId: artifact.entryId,
                type: artifact.type,
                format: artifact.format,
                name: artifact.name,
                content: artifact.content,
                metadata: artifact.metadata,
            })
        } finally {
            await server.close()
        }
    })

    void it('updates the name and content of a text artifact', async () => {
        const { server, updatedInput } = await createServer()
        try {
            const payload = {
                name: 'Edited transcript',
                content: 'Edited content',
            }
            const response = await server.inject({
                method: 'PATCH',
                url: `/entry-artifacts/${artifact.id}`,
                payload,
            })

            assert.equal(response.statusCode, 200)
            assert.deepEqual(updatedInput(), payload)
            const body = entryArtifactDtoSchema.parse(response.json())
            assert.equal(body.name, payload.name)
            assert.equal(body.content, payload.content)
        } finally {
            await server.close()
        }
    })

    void it('rejects an empty update', async () => {
        const { server } = await createServer()
        try {
            const response = await server.inject({
                method: 'PATCH',
                url: `/entry-artifacts/${artifact.id}`,
                payload: {},
            })

            assert.equal(response.statusCode, 400)
        } finally {
            await server.close()
        }
    })
})
