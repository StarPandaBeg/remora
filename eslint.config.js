import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    {
        ignores: [
            '**/.svelte-kit/**',
            '**/dist/**',
            '**/node_modules/**',
            '**/*.d.ts',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked.map((config) => ({
        ...config,
        files: ['**/*.{ts,tsx,mts,cts}'],
    })),
    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
    },
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    eslintConfigPrettier,
)
