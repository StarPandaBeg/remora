import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Entry, EntryArtifact } from '../../database/schema.ts'
import type { RepositoryRegistry } from '../../repositories.ts'
import type { UpdateEntryArtifactContentInput } from './entry-artifacts.model.ts'
import { createEntryArtifactService } from './entry-artifacts.service.ts'

const now = new Date('2026-09-17T10:00:00.000Z')

const entry: Entry = {
    id: 5,
    folderId: 2,
    name: 'Video',
    type: 'video_record',
    content: null,
    metadata: { relatedTasks: [] },
    status: 'processing',
    createdAt: now,
    updatedAt: now,
}

const artifact: EntryArtifact = {
    id: 11,
    entryId: entry.id,
    type: 'transcription',
    format: 'text',
    name: 'Transcript',
    content: 'Initial content',
    metadata: { language: 'ru' },
    createdAt: now,
    updatedAt: now,
}

void describe('entry artifact service', () => {
    void it('creates an artifact for an existing entry', async () => {
        let receivedInput: unknown
        const repositories = {
            entries: { findById: async () => entry },
            entryArtifacts: {
                create: async (input: unknown) => {
                    receivedInput = input
                    return artifact
                },
            },
        } as unknown as RepositoryRegistry
        const service = createEntryArtifactService({ repositories })
        const input = {
            entryId: entry.id,
            type: 'transcription' as const,
            format: 'text' as const,
            name: artifact.name,
            content: artifact.content,
            metadata: artifact.metadata,
        }

        assert.equal(await service.create(input), artifact)
        assert.deepEqual(receivedInput, input)
    })

    void it('rejects creation for a missing entry', async () => {
        const repositories = {
            entries: { findById: async () => undefined },
            entryArtifacts: {},
        } as unknown as RepositoryRegistry
        const service = createEntryArtifactService({ repositories })

        await assert.rejects(
            service.create({
                entryId: 404,
                type: 'transcription',
                format: 'json',
                content: '{}',
            }),
            (error: Error & { code?: string }) =>
                error.code === 'ENTRY_NOT_FOUND',
        )
    })

    void it('updates only content and metadata', async () => {
        let receivedInput: unknown
        const repositories = {
            entries: {},
            entryArtifacts: {
                updateContentAndMetadata: async (
                    _id: number,
                    input: UpdateEntryArtifactContentInput,
                ) => {
                    receivedInput = input
                    return { ...artifact, ...input }
                },
            },
        } as unknown as RepositoryRegistry
        const service = createEntryArtifactService({ repositories })
        const input = {
            content: 'Updated content',
            metadata: { language: 'en', version: 2 },
        }

        const updated = await service.updateContentAndMetadata(
            artifact.id,
            input,
        )

        assert.deepEqual(receivedInput, input)
        assert.equal(updated.content, input.content)
        assert.deepEqual(updated.metadata, input.metadata)
        assert.equal(updated.name, artifact.name)
        assert.equal(updated.type, artifact.type)
        assert.equal(updated.format, artifact.format)
    })

    void it('updates the name and content of a text artifact', async () => {
        let receivedInput: unknown
        const repositories = {
            entries: {},
            entryArtifacts: {
                findById: async () => artifact,
                updateText: async (_id: number, input: unknown) => {
                    receivedInput = input
                    return { ...artifact, ...(input as object) }
                },
            },
        } as unknown as RepositoryRegistry
        const service = createEntryArtifactService({ repositories })
        const input = { name: 'Edited transcript', content: 'Edited text' }

        const updated = await service.updateText(artifact.id, input)

        assert.deepEqual(receivedInput, input)
        assert.equal(updated.name, input.name)
        assert.equal(updated.content, input.content)
    })

    void it('rejects editing a non-text artifact', async () => {
        let updateCalled = false
        const repositories = {
            entries: {},
            entryArtifacts: {
                findById: async () => ({ ...artifact, format: 'blob' }),
                updateText: async () => {
                    updateCalled = true
                    return artifact
                },
            },
        } as unknown as RepositoryRegistry
        const service = createEntryArtifactService({ repositories })

        await assert.rejects(
            service.updateText(artifact.id, { content: 'Edited text' }),
            (error: Error & { code?: string; statusCode?: number }) =>
                error.code === 'ENTRY_ARTIFACT_NOT_TEXT' &&
                error.statusCode === 409,
        )
        assert.equal(updateCalled, false)
    })
})
