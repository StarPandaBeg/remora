declare namespace NodeJS {
    interface ProcessEnv {
        HOST?: string
        PORT?: `${number}`
        POSTGRES_URL?: string
    }
}
