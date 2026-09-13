import { extname } from 'node:path'

import { HttpError } from '../util/error.ts'

const videoFormats = [
    { extension: '.mp4', mimeTypes: ['video/mp4'] },
    {
        extension: '.mov',
        mimeTypes: ['video/quicktime', 'video/x-quicktime'],
    },
] as const

export interface VideoFileDescription {
    filename: string
    mimeType: string
    size: number
    header: Buffer
}

export function validateVideoFile(
    file: VideoFileDescription,
    maxSize: number,
): string {
    if (file.size <= 0) {
        throw new HttpError('VIDEO_EMPTY', 'The video file is empty', 400)
    }
    if (file.size > maxSize) {
        throw new HttpError(
            'VIDEO_TOO_LARGE',
            `The video file exceeds the ${maxSize} byte limit`,
            413,
        )
    }

    const extension = extname(file.filename).toLowerCase()
    const format = videoFormats.find(
        (candidate) =>
            candidate.extension === extension &&
            candidate.mimeTypes.some((mimeType) => mimeType === file.mimeType),
    )
    if (!format) {
        throw new HttpError(
            'VIDEO_FORMAT_UNSUPPORTED',
            'Supported video formats are MP4 (video/mp4) and MOV (video/quicktime)',
            415,
        )
    }

    // MP4 and modern MOV files are ISO base media files with an `ftyp` box.
    if (
        file.header.length < 12 ||
        file.header.toString('ascii', 4, 8) !== 'ftyp'
    ) {
        throw new HttpError(
            'VIDEO_CONTENT_INVALID',
            'The uploaded file does not contain a valid MP4/MOV header',
            400,
        )
    }

    return format.extension
}
