import { Client } from 'minio'

import type { AppConfig } from '../config.ts'
import type { ObjectStorage } from './object-storage.ts'

export function createMinioStorage(
    config: AppConfig['minio'],
    client: Client = new Client({
        endPoint: config.endpoint,
        port: config.port,
        useSSL: config.useSsl,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
    }),
): ObjectStorage {
    const ensureBucket = async () => {
        if (await client.bucketExists(config.bucket)) return

        try {
            await client.makeBucket(config.bucket, config.region)
        } catch (error) {
            // Another application instance may have created it concurrently.
            if (!(await client.bucketExists(config.bucket))) throw error
        }
    }

    return {
        ensureBucket,
        async getObject(reference) {
            return await client.getObject(reference.bucket, reference.objectKey)
        },
        async putObject({ body, contentType, objectKey, size }) {
            await client.putObject(config.bucket, objectKey, body, size, {
                'Content-Type': contentType,
            })
            return { bucket: config.bucket, objectKey }
        },
        async removeObject(reference) {
            await client.removeObject(reference.bucket, reference.objectKey)
        },
    }
}
