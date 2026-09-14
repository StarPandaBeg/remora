import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { DbExecutor } from '../../database/index.ts'
import { createRuntimeConfigRepository } from './config.model.ts'

void describe('runtime config repository', () => {
    void it('reads individual and all config entries', async () => {
        const one = { key: 'video.frameInterval', value: 12 }
        const all = [one]
        const db = {
            query: {
                configEntries: {
                    findFirst: async () => one,
                    findMany: async () => all,
                },
            },
        } as unknown as DbExecutor
        const repository = createRuntimeConfigRepository(db)

        assert.equal(await repository.get(one.key), one)
        assert.equal(await repository.getAll(), all)
    })

    void it('upserts one or multiple values in a single statement', async () => {
        const inserted: unknown[] = []
        let conflicts = 0
        const returning = async () => inserted
        const db = {
            insert: () => ({
                values: (values: unknown[]) => {
                    inserted.push(...values)
                    return {
                        onConflictDoUpdate: () => {
                            conflicts += 1
                            return { returning }
                        },
                    }
                },
            }),
        } as unknown as DbExecutor
        const repository = createRuntimeConfigRepository(db)

        await repository.setMany({
            'video.frameInterval': 15,
            'video.frames.enabled': false,
        })

        assert.deepEqual(inserted, [
            { key: 'video.frameInterval', value: 15 },
            { key: 'video.frames.enabled', value: false },
        ])
        assert.equal(conflicts, 1)
    })

    void it('deletes an override by key', async () => {
        let deletedKey: unknown
        const returning = async () => [{ key: 'video.frameInterval' }]
        const db = {
            delete: () => ({
                where: (condition: unknown) => {
                    deletedKey = condition
                    return { returning }
                },
            }),
        } as unknown as DbExecutor
        const repository = createRuntimeConfigRepository(db)

        const deleted = await repository.delete('video.frameInterval')

        assert.ok(deletedKey)
        assert.equal(deleted?.key, 'video.frameInterval')
    })
})
