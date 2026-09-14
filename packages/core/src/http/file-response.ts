import type { Readable } from 'node:stream'

import type { FastifyReply } from 'fastify'

export interface FileResponse {
    body: Readable
    disposition: 'inline' | 'attachment'
    mimeType: string
    originalName: string
    size: number
}

function encodeFilename(originalName: string) {
    const encodedName = encodeURIComponent(originalName).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    return `filename*=UTF-8''${encodedName}`
}

export function sendFile(reply: FastifyReply, file: FileResponse) {
    return reply
        .type(file.mimeType)
        .header('Content-Length', file.size)
        .header(
            'Content-Disposition',
            `${file.disposition}; ${encodeFilename(file.originalName)}`,
        )
        .send(file.body)
}
