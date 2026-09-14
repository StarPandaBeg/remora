import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
    createWorker,
    WorkerRequestError,
    type WorkerTaskCommand,
} from './worker.ts'

const command: WorkerTaskCommand = {
    pipeline: 'video_summary',
    type: 'summarize',
    taskId: 42,
    input: { objectKey: 'entries/video.mp4' },
    config: { language: 'ru' },
}

function acceptedResponse(): Response {
    return Response.json({ accepted: true }, { status: 202 })
}

void describe('worker client', () => {
    void it('posts a command with an internally generated callback URL', async () => {
        let requestUrl: string | URL | Request | undefined
        let requestInit: RequestInit | undefined
        const worker = createWorker({
            publicBaseUrl: 'https://core.example',
            workerUrl: 'http://remora-worker:8000',
            requestTimeoutMs: 1_000,
            fetch: async (url, init) => {
                requestUrl = url
                requestInit = init
                return acceptedResponse()
            },
        })

        // callbackUrl is deliberately absent from the caller-facing command.
        await worker.execute(command)

        assert.equal(requestUrl, 'http://remora-worker:8000/tasks/execute')
        assert.ok(requestInit)
        assert.equal(requestInit.method, 'POST')
        assert.deepEqual(requestInit.headers, {
            'Content-Type': 'application/json',
        })
        assert.ok(requestInit.signal instanceof AbortSignal)
        const body = requestInit.body
        assert.equal(typeof body, 'string')
        if (typeof body !== 'string') assert.fail('Expected a JSON body')
        assert.deepEqual(JSON.parse(body), {
            pipeline: 'video_summary',
            type: 'summarize',
            taskId: 42,
            input: { objectKey: 'entries/video.mp4' },
            config: { language: 'ru' },
            callbackUrl: 'https://core.example/v1/tasks/events',
        })
    })

    void it('accepts only HTTP 202 with accepted true', async () => {
        const worker = createWorker({
            publicBaseUrl: 'https://core.example',
            workerUrl: 'http://remora-worker:8000',
            requestTimeoutMs: 1_000,
            fetch: async () => acceptedResponse(),
        })

        await worker.execute(command)
    })

    void it('reports network errors without retrying', async () => {
        const networkError = new TypeError('fetch failed')
        let requests = 0
        const worker = createWorker({
            publicBaseUrl: 'https://core.example',
            workerUrl: 'http://remora-worker:8000',
            requestTimeoutMs: 1_000,
            fetch: async () => {
                requests += 1
                throw networkError
            },
        })

        await assert.rejects(worker.execute(command), (error: unknown) => {
            assert.ok(error instanceof WorkerRequestError)
            assert.equal(error.message, 'Worker request failed')
            assert.equal(error.cause, networkError)
            return true
        })
        assert.equal(requests, 1)
    })

    void it('times out only the execute request', async () => {
        const keepEventLoopAlive = setTimeout(() => undefined, 100)
        const worker = createWorker({
            publicBaseUrl: 'https://core.example',
            workerUrl: 'http://remora-worker:8000',
            requestTimeoutMs: 5,
            fetch: async (_url, init) =>
                await new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new Error('request aborted'))
                    })
                }),
        })

        try {
            await assert.rejects(
                worker.execute(command),
                /Worker request timed out after 5ms/,
            )
        } finally {
            clearTimeout(keepEventLoopAlive)
        }
    })

    for (const status of [400, 503]) {
        void it(`rejects HTTP ${status}`, async () => {
            const worker = createWorker({
                publicBaseUrl: 'https://core.example',
                workerUrl: 'http://remora-worker:8000',
                requestTimeoutMs: 1_000,
                fetch: async () => new Response(null, { status }),
            })

            await assert.rejects(
                worker.execute(command),
                new RegExp(`unexpected HTTP status ${status}`),
            )
        })
    }

    void it('rejects a non-202 success status', async () => {
        const worker = createWorker({
            publicBaseUrl: 'https://core.example',
            workerUrl: 'http://remora-worker:8000',
            requestTimeoutMs: 1_000,
            fetch: async () => Response.json({ accepted: true }),
        })

        await assert.rejects(worker.execute(command), /HTTP status 200/)
    })

    void it('rejects invalid JSON', async () => {
        const worker = createWorker({
            publicBaseUrl: 'https://core.example',
            workerUrl: 'http://remora-worker:8000',
            requestTimeoutMs: 1_000,
            fetch: async () => new Response('{', { status: 202 }),
        })

        await assert.rejects(worker.execute(command), /invalid JSON/)
    })

    void it('rejects accepted false', async () => {
        const worker = createWorker({
            publicBaseUrl: 'https://core.example',
            workerUrl: 'http://remora-worker:8000',
            requestTimeoutMs: 1_000,
            fetch: async () =>
                Response.json({ accepted: false }, { status: 202 }),
        })

        await assert.rejects(
            worker.execute(command),
            /unexpected response body/,
        )
    })

    for (const body of [null, [], {}, { accepted: 'true' }]) {
        void it(`rejects unexpected response body ${JSON.stringify(body)}`, async () => {
            const worker = createWorker({
                publicBaseUrl: 'https://core.example',
                workerUrl: 'http://remora-worker:8000',
                requestTimeoutMs: 1_000,
                fetch: async () => Response.json(body, { status: 202 }),
            })

            await assert.rejects(
                worker.execute(command),
                /unexpected response body/,
            )
        })
    }
})
