import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HttpError } from '../util/error.ts'
import { validateVideoFile } from './video.ts'

const validHeader = Buffer.from([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
])

void describe('validateVideoFile', () => {
    void it('accepts MP4 and MOV files with matching MIME types', () => {
        assert.equal(
            validateVideoFile(
                {
                    filename: 'recording.mp4',
                    mimeType: 'video/mp4',
                    size: 12,
                    header: validHeader,
                },
                100,
            ),
            '.mp4',
        )
        assert.equal(
            validateVideoFile(
                {
                    filename: 'recording.MOV',
                    mimeType: 'video/quicktime',
                    size: 12,
                    header: validHeader,
                },
                100,
            ),
            '.mov',
        )
    })

    void it('rejects a spoofed video file', () => {
        assert.throws(
            () =>
                validateVideoFile(
                    {
                        filename: 'not-a-video.mp4',
                        mimeType: 'video/mp4',
                        size: 12,
                        header: Buffer.alloc(12),
                    },
                    100,
                ),
            (error: unknown) =>
                error instanceof HttpError &&
                error.code === 'VIDEO_CONTENT_INVALID',
        )
    })
})
