import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ConfigEntry } from '../../database/schema.ts'
import type {
    RepositoryRegistry,
    TransactionRunner,
} from '../../repositories.ts'
import { HttpError } from '../../util/error.ts'
import {
    createRuntimeConfigService,
    getDefaultRuntimeConfig,
    isRuntimeConfigKey,
    validateRuntimeConfigValue,
} from './config.ts'
import { configDefinitions } from './definitions.ts'

function createHarness(initial: Record<string, ConfigEntry['value']> = {}) {
    const overrides = new Map(Object.entries(initial))
    const now = new Date('2026-09-14T10:00:00.000Z')
    let transactions = 0

    const toEntry = ([key, value]: [string, ConfigEntry['value']]) => ({
        key,
        value,
        createdAt: now,
        updatedAt: now,
    })
    const config = {
        get: async (key: string) => {
            const value = overrides.get(key)
            return value === undefined ? undefined : toEntry([key, value])
        },
        getAll: async () => [...overrides].map(toEntry),
        set: async (key: string, value: ConfigEntry['value']) => {
            overrides.set(key, value)
            return toEntry([key, value])
        },
        setMany: async (values: Record<string, ConfigEntry['value']>) => {
            for (const [key, value] of Object.entries(values)) {
                overrides.set(key, value)
            }
            return Object.entries(values).map(toEntry)
        },
        delete: async (key: string) => {
            const value = overrides.get(key)
            overrides.delete(key)
            return value === undefined ? undefined : toEntry([key, value])
        },
    }
    const repositories = { config } as unknown as RepositoryRegistry
    const transaction: TransactionRunner = async (work) => {
        transactions += 1
        return await work(repositories)
    }

    return {
        overrides,
        service: createRuntimeConfigService(repositories, transaction),
        transactionCount: () => transactions,
    }
}

void describe('runtime config service', () => {
    void it('derives keys, defaults and validation from definitions', () => {
        const defaults = getDefaultRuntimeConfig()

        assert.deepEqual(Object.keys(defaults), Object.keys(configDefinitions))
        for (const [key, definition] of Object.entries(configDefinitions)) {
            assert.equal(isRuntimeConfigKey(key), true)
            assert.equal(
                defaults[key as keyof typeof defaults],
                definition.default,
            )
            assert.deepEqual(
                validateRuntimeConfigValue(
                    key as keyof typeof configDefinitions,
                    definition.default,
                ),
                definition.schema.parse(definition.default),
            )
        }
    })

    void it('uses code defaults when there are no database overrides', async () => {
        const { service } = createHarness()

        assert.deepEqual(
            await service.getEffective(),
            getDefaultRuntimeConfig(),
        )
    })

    void it('applies database overrides over defaults', async () => {
        const { service } = createHarness({
            'video_record.prefer_source': true,
        })

        assert.deepEqual(await service.getEffective(), {
            'video_record.prefer_source': true,
        })
    })

    void it('updates one key without changing other effective values', async () => {
        const { service } = createHarness()

        const effective = await service.update({
            'video_record.prefer_source': true,
        })

        assert.deepEqual(effective, {
            'video_record.prefer_source': true,
        })
    })

    void it('updates values atomically through a transaction', async () => {
        const harness = createHarness()

        const effective = await harness.service.update({
            'video_record.prefer_source': true,
        })

        assert.equal(harness.transactionCount(), 1)
        assert.deepEqual(effective, {
            'video_record.prefer_source': true,
        })
    })

    void it('rejects unknown keys before changing stored overrides', async () => {
        const harness = createHarness()

        await assert.rejects(
            harness.service.update({
                'video_record.prefer_source': true,
                'video_record.prefer_souce': false,
            }),
            (error: unknown) => {
                assert.ok(error instanceof HttpError)
                assert.equal(error.code, 'CONFIG_KEY_UNKNOWN')
                assert.equal(error.statusCode, 400)
                return true
            },
        )
        assert.equal(harness.transactionCount(), 0)
        assert.deepEqual([...harness.overrides], [])
    })

    void it('rejects values that do not match the definition', async () => {
        const { service } = createHarness()

        await assert.rejects(
            service.update({ 'video_record.prefer_source': 'yes' }),
            (error: unknown) => {
                assert.ok(error instanceof HttpError)
                assert.equal(error.code, 'CONFIG_VALUE_INVALID')
                assert.equal(error.statusCode, 400)
                return true
            },
        )
    })

    void it('deletes an override and falls back to the default', async () => {
        const harness = createHarness({
            'video_record.prefer_source': true,
        })

        await harness.service.reset('video_record.prefer_source')

        assert.equal(harness.overrides.has('video_record.prefer_source'), false)
        assert.equal(
            (await harness.service.getEffective())[
                'video_record.prefer_source'
            ],
            false,
        )
    })

    void it('observes changes on every read without a restart', async () => {
        const harness = createHarness()
        assert.equal(
            (await harness.service.getEffective())[
                'video_record.prefer_source'
            ],
            false,
        )

        harness.overrides.set('video_record.prefer_source', true)

        assert.equal(
            (await harness.service.getEffective())[
                'video_record.prefer_source'
            ],
            true,
        )
    })
})
