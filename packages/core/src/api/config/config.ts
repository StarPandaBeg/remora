import { z } from 'zod/v4'

import type {
    RepositoryRegistry,
    TransactionRunner,
} from '../../repositories.ts'
import type { JsonValue } from '../../types/json.ts'
import { HttpError } from '../../util/error.ts'
import { configDefinitions } from './definitions.ts'
import type { RuntimeConfig, RuntimeConfigKey } from './types.ts'

type RuntimeConfigRepository = RepositoryRegistry['config']

export function isRuntimeConfigKey(key: string): key is RuntimeConfigKey {
    return Object.hasOwn(configDefinitions, key)
}

export function getDefaultRuntimeConfig(): RuntimeConfig {
    return Object.fromEntries(
        Object.entries(configDefinitions).map(([key, definition]) => [
            key,
            definition.default,
        ]),
    ) as RuntimeConfig
}

function validateKey(key: string): RuntimeConfigKey {
    if (!isRuntimeConfigKey(key)) {
        throw new HttpError(
            'CONFIG_KEY_UNKNOWN',
            `Unknown runtime config key: ${key}`,
            400,
        )
    }
    return key
}

export function validateRuntimeConfigValue(
    key: RuntimeConfigKey,
    value: JsonValue,
): JsonValue {
    const result = configDefinitions[key].schema.safeParse(value)
    if (!result.success) {
        throw new HttpError(
            'CONFIG_VALUE_INVALID',
            `Invalid value for ${key}: ${z.prettifyError(result.error)}`,
            400,
        )
    }
    return result.data
}

async function buildEffectiveConfig(
    repository: RuntimeConfigRepository,
): Promise<RuntimeConfig> {
    const effective: Record<string, JsonValue> = getDefaultRuntimeConfig()
    const overrides = await repository.getAll()

    for (const override of overrides) {
        if (!isRuntimeConfigKey(override.key)) continue
        effective[override.key] = validateRuntimeConfigValue(
            override.key,
            override.value,
        )
    }

    return effective as RuntimeConfig
}

export function createRuntimeConfigService(
    repositories: RepositoryRegistry,
    transaction: TransactionRunner,
) {
    const getEffective = async () =>
        await buildEffectiveConfig(repositories.config)

    const update = async (input: Record<string, JsonValue>) => {
        const validated: Record<string, JsonValue> = {}
        for (const [rawKey, value] of Object.entries(input)) {
            const key = validateKey(rawKey)
            validated[key] = validateRuntimeConfigValue(key, value)
        }

        return await transaction(async (transactionRepositories) => {
            await transactionRepositories.config.setMany(validated)
            return await buildEffectiveConfig(transactionRepositories.config)
        })
    }

    const reset = async (rawKey: string) => {
        const key = validateKey(rawKey)
        await repositories.config.delete(key)
    }

    const withRepositories = (
        nextRepositories: RepositoryRegistry,
        nextTransaction: TransactionRunner = transaction,
    ) => createRuntimeConfigService(nextRepositories, nextTransaction)

    return { getEffective, reset, update, withRepositories }
}

export type RuntimeConfigService = ReturnType<typeof createRuntimeConfigService>
