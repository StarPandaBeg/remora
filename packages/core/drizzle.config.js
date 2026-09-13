import { defineConfig } from 'drizzle-kit'
import { loadEnvFile } from 'node:process'

try {
    loadEnvFile('../../.env')
} catch (error) {
    if (error?.code !== 'ENOENT') {
        throw error
    }
}

export default defineConfig({
    out: './drizzle',
    schema: './dist/database/schema.js',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.POSTGRES_URL,
    },
})
