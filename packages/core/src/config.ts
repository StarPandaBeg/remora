import { z } from 'zod/v4'

const booleanFromEnvironment = z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')

const environmentSchema = z.object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    PUBLIC_BASE_URL: z.url().optional(),
    WORKER_URL: z.url().default('http://127.0.0.1:8000'),
    WORKER_REQUEST_TIMEOUT: z.coerce.number().int().positive().default(10_000),
    POSTGRES_URL: z.string().min(1),
    MINIO_ENDPOINT: z.string().min(1).default('127.0.0.1'),
    MINIO_PORT: z.coerce.number().int().min(1).max(65_535).default(9000),
    MINIO_USE_SSL: booleanFromEnvironment,
    MINIO_ACCESS_KEY: z.string().min(1),
    MINIO_SECRET_KEY: z.string().min(1),
    MINIO_BUCKET: z
        .string()
        .min(3)
        .max(63)
        .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)
        .default('remora'),
    MINIO_REGION: z.string().min(1).default('us-east-1'),
    WORKER_SECRET: z.string().min(32).optional(),
    MAX_FILE_SIZE_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(10_737_418_240),
})

/** Startup and infrastructure settings. Runtime/user settings live in PostgreSQL. */
export interface AppConfig {
    host: string
    port: number
    publicBaseUrl: string
    workerUrl: string
    workerRequestTimeoutMs: number
    postgresUrl: string
    minio: {
        endpoint: string
        port: number
        useSsl: boolean
        accessKey: string
        secretKey: string
        bucket: string
        region: string
    }
    workerCallbackSecret: string | null
    maxFileSizeBytes: number
}

export function loadConfig(
    environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
    const parsed = environmentSchema.parse(environment)

    return {
        host: parsed.HOST,
        port: parsed.PORT,
        publicBaseUrl: (
            parsed.PUBLIC_BASE_URL ?? `http://${parsed.HOST}:${parsed.PORT}`
        ).replace(/\/+$/, ''),
        workerUrl: parsed.WORKER_URL.replace(/\/+$/, ''),
        workerRequestTimeoutMs: parsed.WORKER_REQUEST_TIMEOUT,
        postgresUrl: parsed.POSTGRES_URL,
        minio: {
            endpoint: parsed.MINIO_ENDPOINT,
            port: parsed.MINIO_PORT,
            useSsl: parsed.MINIO_USE_SSL,
            accessKey: parsed.MINIO_ACCESS_KEY,
            secretKey: parsed.MINIO_SECRET_KEY,
            bucket: parsed.MINIO_BUCKET,
            region: parsed.MINIO_REGION,
        },
        workerCallbackSecret: parsed.WORKER_SECRET ?? null,
        maxFileSizeBytes: parsed.MAX_FILE_SIZE_BYTES,
    }
}
