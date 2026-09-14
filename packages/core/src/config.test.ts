import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { loadConfig } from './config.ts'

void describe('infrastructure configuration', () => {
    void it('continues to load database, worker, server and MinIO settings from env', () => {
        const config = loadConfig({
            HOST: '0.0.0.0',
            PORT: '4100',
            PUBLIC_BASE_URL: 'https://core.example/',
            WORKER_CALLBACK_BASE_URL: 'http://core.internal:3000/',
            WORKER_URL: 'http://worker:8000/',
            WORKER_REQUEST_TIMEOUT: '2500',
            POSTGRES_URL: 'postgres://remora:password@database/remora',
            MINIO_ENDPOINT: 'minio',
            MINIO_PORT: '9443',
            MINIO_USE_SSL: 'true',
            MINIO_ACCESS_KEY: 'access-key',
            MINIO_SECRET_KEY: 'secret-key',
            MINIO_BUCKET: 'remora-data',
            MINIO_REGION: 'eu-west-1',
            WORKER_SECRET: 'worker-secret-with-at-least-32-chars',
            MAX_FILE_SIZE_BYTES: '2048',
        })

        assert.equal(config.host, '0.0.0.0')
        assert.equal(config.port, 4100)
        assert.equal(config.publicBaseUrl, 'https://core.example')
        assert.equal(config.workerCallbackBaseUrl, 'http://core.internal:3000')
        assert.equal(config.workerUrl, 'http://worker:8000')
        assert.equal(
            config.postgresUrl,
            'postgres://remora:password@database/remora',
        )
        assert.deepEqual(config.minio, {
            endpoint: 'minio',
            port: 9443,
            useSsl: true,
            accessKey: 'access-key',
            secretKey: 'secret-key',
            bucket: 'remora-data',
            region: 'eu-west-1',
        })
    })
})
