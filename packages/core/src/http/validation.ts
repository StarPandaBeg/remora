import { z } from 'zod/v4'

import { HttpError } from '../util/error.ts'

export function parseHttpInput<T>(
    schema: z.ZodType<T>,
    input: unknown,
    errorCode = 'REQUEST_INPUT_INVALID',
): T {
    const result = schema.safeParse(input)
    if (!result.success) {
        throw new HttpError(errorCode, z.prettifyError(result.error), 400)
    }
    return result.data
}
