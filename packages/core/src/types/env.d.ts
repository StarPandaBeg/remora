declare namespace NodeJS {
    interface ProcessEnv {
        HOST?: string
        PORT?: `${number}`
        PUBLIC_BASE_URL?: string
        POSTGRES_URL?: string
        MINIO_ENDPOINT?: string
        MINIO_PORT?: `${number}`
        MINIO_USE_SSL?: 'true' | 'false'
        MINIO_ACCESS_KEY?: string
        MINIO_SECRET_KEY?: string
        MINIO_BUCKET?: string
        MINIO_REGION?: string
        MAX_FILE_SIZE_BYTES?: `${number}`
    }
}
