export class HttpError extends Error {
    readonly code: string
    readonly statusCode: number

    constructor(code: string, message: string, statusCode: number = 404) {
        super(message)
        this.name = 'HttpError'
        this.code = code
        this.statusCode = statusCode
    }
}
